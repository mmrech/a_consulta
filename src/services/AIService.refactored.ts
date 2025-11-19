/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AIService
 * Handles all Gemini AI integration functions for the Clinical Extractor
 *
 * This service has been refactored to use DirectGeminiClient for all Gemini API interactions.
 * AIService now acts as a thin wrapper that handles:
 * - PDF text extraction and caching
 * - UI updates and status messages
 * - Form field population
 * - Extraction tracking
 *
 * Includes 7 AI-powered functions:
 * 1. generatePICO() - Extract PICO-T summary (gemini-2.5-flash)
 * 2. generateSummary() - Generate key findings summary (gemini-flash-latest)
 * 3. validateFieldWithAI() - Validate field content (gemini-2.5-pro)
 * 4. findMetadata() - Search for study metadata (gemini-2.5-flash + Google Search)
 * 5. handleExtractTables() - Extract tables from document (gemini-2.5-pro)
 * 6. handleImageAnalysis() - Analyze uploaded images (gemini-2.5-flash)
 * 7. handleDeepAnalysis() - Deep document analysis (gemini-2.5-pro + thinking)
 *
 * ⚠️ SECURITY WARNING:
 * This service uses DirectGeminiClient which loads the API key from environment variables.
 * For production deployments, use the backend proxy architecture (BackendProxyService).
 */

import directGeminiClient from './DirectGeminiClient';
import AppStateManager from '../state/AppStateManager';
import ExtractionTracker from '../data/ExtractionTracker';
import StatusManager from '../utils/status';
import LRUCache from '../utils/LRUCache';
import { logErrorWithContext } from '../utils/aiErrorHandler';

// ==================== PDF TEXT EXTRACTION & CACHING ====================

/**
 * LRU Cache for PDF text with 50-page limit
 */
const pdfTextLRUCache = new LRUCache<number, { fullText: string, items: Array<any> }>(50);

// ==================== HELPER FUNCTIONS ====================

/**
 * Gets text content from a specific PDF page, using LRU cache if available.
 * @param {number} pageNum - The page number.
 * @returns {Promise<{fullText: string, items: Array<any>}>}
 */
async function getPageText(pageNum: number): Promise<{ fullText: string, items: Array<any> }> {
    const cached = pdfTextLRUCache.get(pageNum);
    if (cached) {
        return cached;
    }

    const state = AppStateManager.getState();
    if (!state.pdfDoc) {
        throw new Error('No PDF loaded');
    }
    try {
        const page = await state.pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        let fullText = '';
        const items: Array<any> = [];
        textContent.items.forEach((item: any) => {
            if (item.str) {
                fullText += item.str + ' ';
                items.push({ text: item.str, transform: item.transform });
            }
        });
        const pageData = { fullText, items };
        pdfTextLRUCache.set(pageNum, pageData);
        return pageData;
    } catch (error) {
        console.error(`Error getting text from page ${pageNum}:`, error);
        logErrorWithContext(error, `PDF text extraction - page ${pageNum}`);

        throw new Error(
            `Failed to extract text from page ${pageNum}. ` +
            `${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}

/**
 * Gets all text from the loaded PDF document with page-level error tracking.
 * @returns {Promise<string|null>} Full text of the document or null if no PDF is loaded.
 */
async function getAllPdfText(): Promise<string | null> {
    const state = AppStateManager.getState();
    if (!state.pdfDoc) {
        StatusManager.show("Please load a PDF first.", "warning");
        return null;
    }

    let fullText = "";
    const failedPages: number[] = [];
    StatusManager.show("Reading full document text...", "info", 60000);

    for (let i = 1; i <= state.totalPages; i++) {
        try {
            const pageData = await getPageText(i);
            if (!pageData.fullText || pageData.fullText.trim() === '') {
                failedPages.push(i);
                console.warn(`Page ${i} returned empty text`);
            }
            fullText += pageData.fullText + "\n\n";
        } catch (error) {
            console.error(`Failed to read page ${i}:`, error);
            failedPages.push(i);
        }
    }

    if (failedPages.length > 0) {
        StatusManager.show(
            `⚠️ Warning: Failed to read ${failedPages.length} page(s): ${failedPages.join(', ')}`,
            'warning',
            10000
        );
    }

    if (!fullText.trim()) {
        throw new Error(
            'No text could be extracted from the PDF. The document may be image-based, corrupted, or have no selectable text.'
        );
    }

    StatusManager.show("Document text reading complete.", "success");
    return fullText;
}

/**
 * Converts a Blob to base64 string
 */
function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            resolve((reader.result as string).split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// ==================== AI EXTRACTION FUNCTIONS ====================

/**
 * ✨ Generates PICO-T summary using DirectGeminiClient
 */
async function generatePICO(): Promise<void> {
    const state = AppStateManager.getState();
    if (!state.pdfDoc) {
        StatusManager.show('Please load a PDF first.', 'warning');
        return;
    }
    if (state.isProcessing) {
        StatusManager.show('Please wait for the current operation to finish.', 'warning');
        return;
    }

    AppStateManager.setState({ isProcessing: true });
    const loadingEl = document.getElementById('pico-loading');
    if (loadingEl) loadingEl.style.display = 'block';
    StatusManager.show('✨ Analyzing document for PICO-T summary...', 'info');

    try {
        const documentText = await getAllPdfText();
        if (!documentText) {
            throw new Error("Could not read text from the PDF.");
        }

        const data = await directGeminiClient.generatePICO(documentText);

        // Populate fields
        const populationField = document.getElementById('eligibility-population') as HTMLInputElement;
        const interventionField = document.getElementById('eligibility-intervention') as HTMLInputElement;
        const comparatorField = document.getElementById('eligibility-comparator') as HTMLInputElement;
        const outcomesField = document.getElementById('eligibility-outcomes') as HTMLInputElement;
        const timingField = document.getElementById('eligibility-timing') as HTMLInputElement;
        const typeField = document.getElementById('eligibility-type') as HTMLInputElement;

        if (populationField) populationField.value = data.population || '';
        if (interventionField) interventionField.value = data.intervention || '';
        if (comparatorField) comparatorField.value = data.comparator || '';
        if (outcomesField) outcomesField.value = data.outcomes || '';
        if (timingField) timingField.value = data.timing || '';
        if (typeField) typeField.value = data.studyType || '';

        // Add to trace log
        const state2 = AppStateManager.getState();
        const coords = { x: 0, y: 0, width: 0, height: 0 };
        ExtractionTracker.addExtraction({ fieldName: 'population (AI)', text: data.population, page: 0, coordinates: coords, method: 'gemini-pico', documentName: state2.documentName });
        ExtractionTracker.addExtraction({ fieldName: 'intervention (AI)', text: data.intervention, page: 0, coordinates: coords, method: 'gemini-pico', documentName: state2.documentName });
        ExtractionTracker.addExtraction({ fieldName: 'comparator (AI)', text: data.comparator, page: 0, coordinates: coords, method: 'gemini-pico', documentName: state2.documentName });
        ExtractionTracker.addExtraction({ fieldName: 'outcomes (AI)', text: data.outcomes, page: 0, coordinates: coords, method: 'gemini-pico', documentName: state2.documentName });
        ExtractionTracker.addExtraction({ fieldName: 'timing (AI)', text: data.timing, page: 0, coordinates: coords, method: 'gemini-pico', documentName: state2.documentName });
        ExtractionTracker.addExtraction({ fieldName: 'studyType (AI)', text: data.studyType, page: 0, coordinates: coords, method: 'gemini-pico', documentName: state2.documentName });

        StatusManager.show('✨ PICO-T fields auto-populated by Gemini!', 'success');

    } catch (error: any) {
        logErrorWithContext(error, 'PICO-T extraction');
        StatusManager.show(error.message || 'Failed to generate PICO-T summary', 'error', 15000);
    } finally {
        AppStateManager.setState({ isProcessing: false });
        const loadingEl = document.getElementById('pico-loading');
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

/**
 * ✨ Generates summary using DirectGeminiClient
 */
async function generateSummary(): Promise<void> {
    const state = AppStateManager.getState();
    if (!state.pdfDoc) {
        StatusManager.show('Please load a PDF first.', 'warning');
        return;
    }
    if (state.isProcessing) {
        StatusManager.show('Please wait for the current operation to finish.', 'warning');
        return;
    }

    AppStateManager.setState({ isProcessing: true });
    const loadingEl = document.getElementById('summary-loading');
    if (loadingEl) loadingEl.style.display = 'block';
    StatusManager.show('✨ Asking Gemini for summary...', 'info');

    try {
        const documentText = await getAllPdfText();
        if (!documentText) {
            throw new Error("Could not read text from the PDF.");
        }

        const summaryText = await directGeminiClient.generateSummary(documentText);

        const summaryField = document.getElementById('predictorsPoorOutcomeSurgical') as HTMLTextAreaElement;
        if (summaryField) summaryField.value = summaryText;

        const state2 = AppStateManager.getState();
        ExtractionTracker.addExtraction({
            fieldName: 'summary (AI)',
            text: summaryText,
            page: 0,
            coordinates: {x:0, y:0, width:0, height:0},
            method: 'gemini-summary',
            documentName: state2.documentName
        });

        StatusManager.show('✨ Key findings summary generated by Gemini!', 'success');

    } catch (error: any) {
        logErrorWithContext(error, 'Summary generation');
        StatusManager.show(error.message || 'Failed to generate summary', 'error', 15000);
    } finally {
        AppStateManager.setState({ isProcessing: false });
        const loadingEl = document.getElementById('summary-loading');
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

/**
 * ✨ Validates field using DirectGeminiClient
 */
async function validateFieldWithAI(fieldId: string): Promise<void> {
    const state = AppStateManager.getState();
    const field = document.getElementById(fieldId) as HTMLInputElement;
    if (!field) {
        StatusManager.show(`Field ${fieldId} not found.`, 'error');
        return;
    }

    const claim = field.value;
    if (!claim) {
        StatusManager.show('Field is empty, nothing to validate.', 'warning');
        return;
    }

    if (!state.pdfDoc) {
        StatusManager.show('Please load a PDF first.', 'warning');
        return;
    }
    if (state.isProcessing) {
        StatusManager.show('Please wait for the current operation to finish.', 'warning');
        return;
    }

    AppStateManager.setState({ isProcessing: true });
    StatusManager.showLoading(true);
    StatusManager.show(`✨ Validating claim with Gemini: "${claim.substring(0, 30)}..."`, 'info');

    try {
        const documentText = await getAllPdfText();
        if (!documentText) {
            throw new Error("Could not read text from PDF for validation.");
        }

        const validation = await directGeminiClient.validateField(fieldId, claim, documentText);

        if (validation.is_supported) {
            StatusManager.show(`✓ VALIDATED (Confidence: ${Math.round(validation.confidence_score * 100)}%): "${validation.supporting_quote}"`, 'success', 10000);
            field.style.borderColor = 'var(--success-green)';
        } else {
            StatusManager.show(`✗ NOT SUPPORTED (Confidence: ${Math.round(validation.confidence_score * 100)}%). Reason: "${validation.supporting_quote}"`, 'warning', 10000);
            field.style.borderColor = 'var(--warning-orange)';
        }

    } catch (error: any) {
        logErrorWithContext(error, 'Field validation');
        StatusManager.show(error.message || 'Failed to validate field', 'error', 15000);
    } finally {
        AppStateManager.setState({ isProcessing: false });
        StatusManager.showLoading(false);
    }
}

/**
 * ✨ Finds metadata using DirectGeminiClient
 */
async function findMetadata(): Promise<void> {
    const state = AppStateManager.getState();
    if (state.isProcessing) {
        StatusManager.show('Please wait for the current operation to finish.', 'warning');
        return;
    }
    const citationField = document.getElementById('citation') as HTMLInputElement;
    const citationText = citationField?.value || '';
    if (!citationText) {
        StatusManager.show('Please enter a citation or title first.', 'warning');
        return;
    }

    AppStateManager.setState({ isProcessing: true });
    const loadingEl = document.getElementById('metadata-loading');
    if (loadingEl) loadingEl.style.display = 'block';
    StatusManager.show('✨ Searching Google for metadata...', 'info');

    try {
        const data = await directGeminiClient.findMetadata(citationText);

        const doiField = document.getElementById('doi') as HTMLInputElement;
        const pmidField = document.getElementById('pmid') as HTMLInputElement;
        const journalField = document.getElementById('journal') as HTMLInputElement;
        const yearField = document.getElementById('year') as HTMLInputElement;

        if (data.doi && doiField) doiField.value = data.doi;
        if (data.pmid && pmidField) pmidField.value = data.pmid;
        if (data.journal && journalField) journalField.value = data.journal;
        if (data.year && yearField) yearField.value = data.year;

        StatusManager.show('✨ Metadata auto-populated!', 'success');

    } catch (error: any) {
        logErrorWithContext(error, 'Metadata search');
        StatusManager.show(error.message || 'Failed to find metadata', 'error', 15000);
    } finally {
        AppStateManager.setState({ isProcessing: false });
        const loadingEl = document.getElementById('metadata-loading');
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

/**
 * ✨ Extracts tables using DirectGeminiClient
 */
async function handleExtractTables(): Promise<void> {
    const state = AppStateManager.getState();
    const resultsContainer = document.getElementById('table-extraction-results');
    if (!state.pdfDoc) {
        StatusManager.show("Please load a PDF first.", "warning");
        return;
    }

    if (resultsContainer) resultsContainer.innerHTML = 'Extracting tables from document... ✨';
    StatusManager.showLoading(true);

    try {
        const documentText = await getAllPdfText();
        if (!documentText) return;

        const result = await directGeminiClient.extractTables(documentText);

        if (result.tables && result.tables.length > 0 && resultsContainer) {
            renderTables(result.tables, resultsContainer);
            StatusManager.show(`Successfully extracted ${result.tables.length} tables.`, 'success');
        } else {
            if (resultsContainer) resultsContainer.innerText = "No tables found in the document.";
            StatusManager.show("No tables were identified by the AI.", "info");
        }

    } catch (error: any) {
        logErrorWithContext(error, 'Table extraction');
        if (resultsContainer) resultsContainer.innerText = `Error: ${error.message || 'Failed to extract tables'}`;
        StatusManager.show(error.message || 'Failed to extract tables', 'error', 15000);
    } finally {
        StatusManager.showLoading(false);
    }
}

/**
 * Renders extracted tables in the UI
 */
function renderTables(tables: any[], container: HTMLElement): void {
    container.innerHTML = '';
    tables.forEach((tableData, index) => {
        const details = document.createElement('details');
        details.open = true;

        const summary = document.createElement('summary');
        summary.textContent = `Table ${index + 1}: ${tableData.title || 'Untitled'}`;

        const description = document.createElement('p');
        description.textContent = tableData.description || '';
        description.style.fontSize = '11px';
        description.style.fontStyle = 'italic';

        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const tbody = document.createElement('tbody');

        if (tableData.data && tableData.data.length > 0) {
            const headerRow = document.createElement('tr');
            tableData.data[0].forEach((headerText: string) => {
                const th = document.createElement('th');
                th.textContent = headerText;
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);

            for (let i = 1; i < tableData.data.length; i++) {
                const bodyRow = document.createElement('tr');
                tableData.data[i].forEach((cellText: string) => {
                    const td = document.createElement('td');
                    td.textContent = cellText;
                    bodyRow.appendChild(td);
                });
                tbody.appendChild(bodyRow);
            }
        }

        table.appendChild(thead);
        table.appendChild(tbody);

        details.appendChild(summary);
        if(tableData.description) details.appendChild(description);
        details.appendChild(table);

        container.appendChild(details);
    });
}

/**
 * ✨ Analyzes image using DirectGeminiClient
 */
async function handleImageAnalysis(): Promise<void> {
    const fileInput = document.getElementById('image-upload-input') as HTMLInputElement;
    const promptField = document.getElementById('image-analysis-prompt') as HTMLInputElement;
    const resultsContainer = document.getElementById('image-analysis-results');
    const prompt = promptField?.value || '';

    if (!fileInput?.files || fileInput.files.length === 0) {
        StatusManager.show("Please upload an image.", "warning");
        return;
    }
    if (!prompt) {
        StatusManager.show("Please enter a prompt for image analysis.", "warning");
        return;
    }

    const file = fileInput.files[0];
    if (resultsContainer) resultsContainer.innerHTML = 'Analyzing image... ✨';
    StatusManager.showLoading(true);

    try {
        const base64Data = await blobToBase64(file);
        const result = await directGeminiClient.analyzeImage(base64Data, file.type, prompt);

        if (resultsContainer) resultsContainer.innerText = result;

    } catch (error: any) {
        logErrorWithContext(error, 'Image analysis');
        if (resultsContainer) resultsContainer.innerText = `Error: ${error.message || 'Failed to analyze image'}`;
        StatusManager.show(error.message || 'Failed to analyze image', 'error', 15000);
    } finally {
        StatusManager.showLoading(false);
    }
}

/**
 * ✨ Performs deep analysis using DirectGeminiClient
 */
async function handleDeepAnalysis(): Promise<void> {
    const state = AppStateManager.getState();
    const promptField = document.getElementById('deep-analysis-prompt') as HTMLInputElement;
    const resultsContainer = document.getElementById('deep-analysis-results');
    const prompt = promptField?.value || '';

    if (!prompt) {
        StatusManager.show("Please enter a prompt for deep analysis.", "warning");
        return;
    }
    if (!state.pdfDoc) {
        StatusManager.show("Please load a PDF first.", "warning");
        return;
    }

    if (resultsContainer) resultsContainer.innerHTML = 'Thinking deeply... ✨';
    StatusManager.showLoading(true);

    try {
        const documentText = await getAllPdfText();
        if (!documentText) return;

        const result = await directGeminiClient.deepAnalysis(documentText, prompt);

        if (resultsContainer) resultsContainer.innerText = result;

    } catch (error: any) {
        logErrorWithContext(error, 'Deep analysis');
        if (resultsContainer) resultsContainer.innerText = `Error: ${error.message || 'Failed to perform deep analysis'}`;
        StatusManager.show(error.message || 'Failed to perform deep analysis', 'error', 15000);
    } finally {
        StatusManager.showLoading(false);
    }
}

// ==================== EXPORTS ====================

/**
 * AIService object - Central manager for all AI operations
 * Now uses DirectGeminiClient for all Gemini API interactions
 */
const AIService = {
    generatePICO,
    generateSummary,
    validateFieldWithAI,
    findMetadata,
    handleExtractTables,
    handleImageAnalysis,
    handleDeepAnalysis,
    // Helper functions
    getPageText,
    getAllPdfText,
};

export default AIService;

// Export individual functions for window binding
export {
    generatePICO,
    generateSummary,
    validateFieldWithAI,
    findMetadata,
    handleExtractTables,
    handleImageAnalysis,
    handleDeepAnalysis,
};
