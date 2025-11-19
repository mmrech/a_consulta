/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AIService
 * Handles all Gemini AI integration functions for the Clinical Extractor
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
 * This implementation loads the Gemini API key from environment variables, which
 * exposes it in the frontend JavaScript bundle. This is acceptable for:
 * - Development and testing environments
 * - Personal projects and demos
 * - Applications with domain restrictions on the API key
 *
 * For production deployments:
 * - Use a backend proxy or serverless functions to protect the API key
 * - Implement rate limiting and request authentication
 * - Monitor API usage for abuse
 * - Consider using Firebase App Check or similar attestation
 */

import { GoogleGenAI, Type } from "@google/genai";
import AppStateManager from '../state/AppStateManager';
import ExtractionTracker from '../data/ExtractionTracker';
import StatusManager from '../utils/status';
import LRUCache from '../utils/LRUCache';
import CircuitBreaker from '../utils/CircuitBreaker';
import { categorizeAIError, isErrorRetryable, formatErrorMessage, logErrorWithContext } from '../utils/aiErrorHandler';

// ==================== AI CLIENT INITIALIZATION ====================

/**
 * Get Gemini API Key from Vite environment variables
 * Supports multiple environment variable names for backward compatibility:
 * - VITE_GEMINI_API_KEY (preferred)
 * - VITE_API_KEY (alternative)
 * - VITE_GOOGLE_API_KEY (alternative)
 *
 * In Vite, environment variables must be prefixed with VITE_ to be exposed to the client
 * Access via import.meta.env instead of process.env
 */
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY ||
                import.meta.env.VITE_API_KEY ||
                import.meta.env.VITE_GOOGLE_API_KEY;

/**
 * Lazy-initialized AI client instance
 */
let ai: GoogleGenAI | null = null;

/**
 * LRU Cache for PDF text with 50-page limit
 */
const pdfTextLRUCache = new LRUCache<number, { fullText: string, items: Array<any> }>(50);

/**
 * Circuit Breaker for AI service resilience
 */
const aiCircuitBreaker = new CircuitBreaker({
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000,
});

/**
 * Initialize Google Generative AI client with user-friendly error handling
 */
function initializeAI(): GoogleGenAI {
    if (ai) return ai;
    
    if (!API_KEY) {
        const errorMsg = `⚠️ Gemini API Key Not Configured

To use AI features, create a .env.local file in the project root with:
VITE_GEMINI_API_KEY=your_api_key_here

Get your free API key at: https://ai.google.dev/`;
        StatusManager.show(errorMsg, 'error', 30000);
        throw new Error('Gemini API key not configured');
    }
    
    ai = new GoogleGenAI({ apiKey: API_KEY });
    return ai;
}

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

        // Throw error instead of silently returning empty data
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
    StatusManager.show("Reading full document text...", "info", 60000); // Long timeout

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
            // Continue with other pages instead of failing completely
        }
    }

    // Report failed pages to user
    if (failedPages.length > 0) {
        StatusManager.show(
            `⚠️ Warning: Failed to read ${failedPages.length} page(s): ${failedPages.join(', ')}`,
            'warning',
            10000
        );
    }

    // Validate that we got some text
    if (!fullText.trim()) {
        throw new Error(
            'No text could be extracted from the PDF. The document may be image-based, corrupted, or have no selectable text.'
        );
    }

    StatusManager.show("Document text reading complete.", "success");
    return fullText;
}

/**
 * Calls the Gemini API with Google Search grounding.
 * Includes retry logic with exponential backoff for rate limits.
 * @param {string} systemInstruction - The system instruction.
 * @param {string} userPrompt - The user query.
 * @param {object} responseSchema - The JSON schema for the response.
 * @returns {Promise<string>} - The text content from the API response.
 */
async function callGeminiWithSearch(systemInstruction: string, userPrompt: string, responseSchema: any): Promise<string> {
    return await retryWithExponentialBackoff(async () => {
        const response = await initializeAI().models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ parts: [{ text: userPrompt }] }],
            config: {
                systemInstruction,
                tools: [{googleSearch: {}}],
                responseMimeType: "application/json",
                responseSchema
            }
        });
        return response.text;
    }, 'Gemini Search API call');
}

/**
 * Converts a Blob to base64 string
 * @param {Blob} blob - The blob to convert
 * @returns {Promise<string>} - Base64 encoded string
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

// ==================== RETRY LOGIC WITH EXPONENTIAL BACKOFF ====================

/**
 * Retry configuration for API calls
 */
const RETRY_CONFIG = {
    maxAttempts: 3,
    delays: [2000, 4000, 8000], // 2s, 4s, 8s
    retryableStatusCodes: [429, 500, 502, 503, 504]
};

/**
 * Checks if an error is retryable (429, 5xx errors, network errors)
 * Now uses the centralized error categorization system
 * @param error - The error to check
 * @returns True if the error should trigger a retry
 */
function isRetryableError(error: any): boolean {
    // Use centralized error handler for consistent retry logic
    return isErrorRetryable(error);
}

/**
 * Delays execution for a specified number of milliseconds
 * @param ms - Milliseconds to delay
 */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Safely parses JSON with comprehensive error handling
 * @param jsonText - JSON string to parse
 * @param context - Context for error messaging
 * @returns Parsed object
 * @throws Error with user-friendly message if parsing fails
 */
function safeJsonParse(jsonText: string, context: string = 'AI response'): any {
    try {
        if (!jsonText || !jsonText.trim()) {
            throw new Error('AI returned empty response');
        }

        return JSON.parse(jsonText);
    } catch (parseError) {
        console.error(`Failed to parse ${context}:`, jsonText);
        logErrorWithContext(parseError, `JSON Parse - ${context}`, { rawResponse: jsonText });

        throw new Error(
            `AI returned invalid response format. This may indicate the document is too complex or the AI service is degraded. ` +
            `Please try again or contact support if the issue persists.`
        );
    }
}

/**
 * Wraps an async function with exponential backoff retry logic
 * Retries on 429 (rate limit) and 5xx server errors
 * 
 * @param fn - Async function to retry
 * @param context - Description of the operation for user feedback
 * @returns Promise that resolves with the function result
 */
async function retryWithExponentialBackoff<T>(
    fn: () => Promise<T>,
    context: string = 'API call'
): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt < RETRY_CONFIG.maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            
            const isLastAttempt = attempt === RETRY_CONFIG.maxAttempts - 1;
            
            if (!isRetryableError(error)) {
                throw error;
            }
            
            if (isLastAttempt) {
                console.error(`${context} failed after ${RETRY_CONFIG.maxAttempts} attempts`);
                throw error;
            }
            
            const delayMs = RETRY_CONFIG.delays[attempt];
            const delaySec = delayMs / 1000;
            
            console.warn(`${context} failed (attempt ${attempt + 1}/${RETRY_CONFIG.maxAttempts}). Retrying in ${delaySec}s...`);
            console.warn('Error:', error.message || error);
            
            StatusManager.show(
                `AI service is busy, retrying in ${delaySec} seconds... (attempt ${attempt + 1}/${RETRY_CONFIG.maxAttempts})`,
                'warning',
                delayMs
            );
            
            await delay(delayMs);
        }
    }
    
    throw lastError;
}

// ==================== AI EXTRACTION FUNCTIONS ====================

/**
 * ✨ Generates PICO-T summary using Gemini API.
 * Model: gemini-2.5-flash
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
        // Get full text of the document to provide as context
        const documentText = await getAllPdfText();
        if (!documentText) {
            throw new Error("Could not read text from the PDF.");
        }

        const systemPrompt = "You are an expert clinical research assistant specializing in systematic reviews. Your task is to extract PICO-TT (Population, Intervention, Comparator, Outcomes, Timing, and sTudy Type) information from the provided clinical study text using the PICO-TT framework methodology. This framework is essential for systematic review quality and research reproducibility. Return the information as a JSON object. Be concise and accurate. If information is not found, return an empty string for that field.";
        const userPrompt = `Here is the clinical study text:\n\n${documentText}`;

        const picoSchema = {
            type: Type.OBJECT,
            properties: {
                "population": { "type": Type.STRING, "description": "The study population (e.g., '57 patients with malignant cerebellar infarction')" },
                "intervention": { "type": Type.STRING, "description": "The intervention performed (e.g., 'suboccipital decompressive craniectomy (SDC)')" },
                "comparator": { "type": Type.STRING, "description": "The comparison group (e.g., 'best medical treatment alone' or 'no comparator')" },
                "outcomes": { "type": Type.STRING, "description": "The primary outcomes measured (e.g., 'mRS at 12-month follow-up')" },
                "timing": { "type": Type.STRING, "description": "The follow-up timing (e.g., '12-month follow-up')" },
                "studyType": { "type": Type.STRING, "description": "The type of study (e.g., 'retrospective-matched case-control study')" }
            }
        };

        // Call Gemini with circuit breaker and retry logic
        const response = await aiCircuitBreaker.execute(async () => {
            return await retryWithExponentialBackoff(async () => {
                return await initializeAI().models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: [{ parts: [{ text: userPrompt }] }],
                    config: {
                        systemInstruction: systemPrompt,
                        responseMimeType: "application/json",
                        responseSchema: picoSchema
                    }
                });
            }, 'PICO-T extraction');
        });

        const jsonText = response.text;
        const data = safeJsonParse(jsonText, 'PICO-T extraction');

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
        const coords = { x: 0, y: 0, width: 0, height: 0 }; // AI extractions have no coords
        ExtractionTracker.addExtraction({ fieldName: 'population (AI)', text: data.population, page: 0, coordinates: coords, method: 'gemini-pico', documentName: state2.documentName });
        ExtractionTracker.addExtraction({ fieldName: 'intervention (AI)', text: data.intervention, page: 0, coordinates: coords, method: 'gemini-pico', documentName: state2.documentName });
        ExtractionTracker.addExtraction({ fieldName: 'comparator (AI)', text: data.comparator, page: 0, coordinates: coords, method: 'gemini-pico', documentName: state2.documentName });
        ExtractionTracker.addExtraction({ fieldName: 'outcomes (AI)', text: data.outcomes, page: 0, coordinates: coords, method: 'gemini-pico', documentName: state2.documentName });
        ExtractionTracker.addExtraction({ fieldName: 'timing (AI)', text: data.timing, page: 0, coordinates: coords, method: 'gemini-pico', documentName: state2.documentName });
        ExtractionTracker.addExtraction({ fieldName: 'studyType (AI)', text: data.studyType, page: 0, coordinates: coords, method: 'gemini-pico', documentName: state2.documentName });

        StatusManager.show('✨ PICO-T fields auto-populated by Gemini!', 'success');

    } catch (error: any) {
        logErrorWithContext(error, 'PICO-T extraction');
        const categorized = categorizeAIError(error, 'PICO-T extraction');
        StatusManager.show(formatErrorMessage(categorized), 'error', 15000);
    } finally {
        AppStateManager.setState({ isProcessing: false });
        const loadingEl = document.getElementById('pico-loading');
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

/**
 * ✨ Generates a summary of key findings using Gemini API.
 * Model: gemini-flash-latest
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

        const systemPrompt = "You are an expert clinical research assistant. Your task is to read the provided clinical study text and write a concise summary (2-3 paragraphs) focusing on the key findings, outcomes, and any identified predictors of those outcomes.";
        const userPrompt = `Please summarize the following clinical study text:\n\n${documentText}`;

        const response = await aiCircuitBreaker.execute(async () => {
            return await retryWithExponentialBackoff(async () => {
                return await initializeAI().models.generateContent({
                    model: 'gemini-flash-latest',
                    contents: [{ parts: [{ text: userPrompt }] }],
                    config: {
                        systemInstruction: systemPrompt,
                    }
                });
            }, 'Summary generation');
        });

        const summaryText = response.text;

        const summaryField = document.getElementById('predictorsPoorOutcomeSurgical') as HTMLTextAreaElement;
        if (summaryField) summaryField.value = summaryText;

        // Add to trace log
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
        const categorized = categorizeAIError(error, 'Summary generation');
        StatusManager.show(formatErrorMessage(categorized), 'error', 15000);
    } finally {
        AppStateManager.setState({ isProcessing: false });
        const loadingEl = document.getElementById('summary-loading');
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

/**
 * ✨ Validates a field's content against the PDF text using Gemini.
 * Model: gemini-2.5-pro
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

        const systemPrompt = `You are a fact-checking expert specializing in clinical research papers. Your task is to determine if a given "claim" is directly supported by the provided "document text". You must respond with a JSON object.`;
        const userPrompt = `DOCUMENT TEXT:\n"""${documentText}"""\n\nCLAIM:\n"""${claim}"""\n\nBased on the document text, is the claim supported? Provide a direct quote if it is.`;

        const validationSchema = {
            type: Type.OBJECT,
            properties: {
                "is_supported": {
                    type: Type.BOOLEAN,
                    description: "True if the claim is directly supported by the text, otherwise false."
                },
                "supporting_quote": {
                    type: Type.STRING,
                    description: "A direct quote from the document that supports the claim. If not supported, this should be an empty string or a brief explanation."
                },
                "confidence_score": {
                    type: Type.NUMBER,
                    description: "Your confidence in the validation from 0.0 to 1.0."
                }
            },
            required: ["is_supported", "supporting_quote", "confidence_score"]
        };

        const response = await aiCircuitBreaker.execute(async () => {
            return await retryWithExponentialBackoff(async () => {
                return await initializeAI().models.generateContent({
                    model: 'gemini-2.5-pro',
                    contents: [{ parts: [{ text: userPrompt }] }],
                    config: {
                        systemInstruction: systemPrompt,
                        responseMimeType: "application/json",
                        responseSchema: validationSchema
                    }
                });
            }, 'Field validation');
        });

        const jsonText = response.text;
        const validation = safeJsonParse(jsonText, 'Field validation');

        if (validation.is_supported) {
            StatusManager.show(`✓ VALIDATED (Confidence: ${Math.round(validation.confidence_score * 100)}%): "${validation.supporting_quote}"`, 'success', 10000);
            field.style.borderColor = 'var(--success-green)';
        } else {
            StatusManager.show(`✗ NOT SUPPORTED (Confidence: ${Math.round(validation.confidence_score * 100)}%). Reason: "${validation.supporting_quote}"`, 'warning', 10000);
            field.style.borderColor = 'var(--warning-orange)';
        }

    } catch (error: any) {
        logErrorWithContext(error, 'Field validation');
        const categorized = categorizeAIError(error, 'Field validation');
        StatusManager.show(formatErrorMessage(categorized), 'error', 15000);
    } finally {
        AppStateManager.setState({ isProcessing: false });
        StatusManager.showLoading(false);
    }
}

/**
 * ✨ Finds study metadata using Gemini with Google Search.
 * Model: gemini-2.5-flash + Google Search
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
        const systemPrompt = "You are a research assistant. Find the metadata for the given study. Use Google Search to find the information. If a value isn't found, return an empty string for it. Provide only the JSON response.";
        const userPrompt = `Find the DOI, PMID, journal name, and publication year for the following study: "${citationText}"`;

        const metadataSchema = {
            type: Type.OBJECT,
            properties: {
                "doi": { "type": Type.STRING, "description": "The DOI of the paper" },
                "pmid": { "type": Type.STRING, "description": "The PubMed ID (PMID) of the paper" },
                "journal": { "type": Type.STRING, "description": "The name of the journal" },
                "year": { "type": Type.STRING, "description": "The 4-digit publication year" }
            }
        };

        const responseJson = await callGeminiWithSearch(systemPrompt, userPrompt, metadataSchema);
        const data = safeJsonParse(responseJson, 'Metadata search');

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
        const categorized = categorizeAIError(error, 'Metadata search');
        StatusManager.show(formatErrorMessage(categorized), 'error', 15000);
    } finally {
        AppStateManager.setState({ isProcessing: false });
        const loadingEl = document.getElementById('metadata-loading');
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

/**
 * ✨ Extracts tables from the document using Gemini Pro.
 * Model: gemini-2.5-pro
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

        const systemPrompt = `You are a data extraction specialist. Analyze the provided text from a clinical research paper. Identify all tables and extract their content. Structure the output as a JSON object. The object should have a single key 'tables' which is an array. Each object in the array should represent one table and have 'title' (the table's caption or title), 'description' (a brief summary of the table's content), and 'data' (a 2D array of strings representing rows and columns, including headers). If no tables are found, return an empty array for the 'tables' key.`;

        const tableSchema = {
            type: Type.OBJECT,
            properties: {
                tables: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING },
                            description: { type: Type.STRING },
                            data: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.ARRAY,
                                    items: { type: Type.STRING }
                                }
                            }
                        },
                        required: ["title", "data"]
                    }
                }
            }
        };

        const response = await aiCircuitBreaker.execute(async () => {
            return await retryWithExponentialBackoff(async () => {
                return await initializeAI().models.generateContent({
                    model: 'gemini-2.5-pro',
                    contents: documentText,
                    config: {
                        systemInstruction: systemPrompt,
                        responseMimeType: "application/json",
                        responseSchema: tableSchema
                    }
                });
            }, 'Table extraction');
        });

        const jsonText = response.text;
        const result = safeJsonParse(jsonText, 'Table extraction');

        if (result.tables && result.tables.length > 0 && resultsContainer) {
            renderTables(result.tables, resultsContainer);
            StatusManager.show(`Successfully extracted ${result.tables.length} tables.`, 'success');
        } else {
            if (resultsContainer) resultsContainer.innerText = "No tables found in the document.";
            StatusManager.show("No tables were identified by the AI.", "info");
        }

    } catch (error: any) {
        logErrorWithContext(error, 'Table extraction');
        const categorized = categorizeAIError(error, 'Table extraction');
        if (resultsContainer) resultsContainer.innerText = `Error: ${categorized.userMessage}`;
        StatusManager.show(formatErrorMessage(categorized), 'error', 15000);
    } finally {
        StatusManager.showLoading(false);
    }
}

/**
 * Renders extracted tables in the UI
 * @param {Array} tables - Array of table objects
 * @param {HTMLElement} container - Container element to render tables into
 */
function renderTables(tables: any[], container: HTMLElement): void {
    container.innerHTML = '';
    tables.forEach((tableData, index) => {
        const details = document.createElement('details');
        details.open = true; // Open by default

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
            // Assume first row is header
            const headerRow = document.createElement('tr');
            tableData.data[0].forEach((headerText: string) => {
                const th = document.createElement('th');
                th.textContent = headerText;
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);

            // The rest are body rows
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
 * ✨ Analyzes an uploaded image with a text prompt using Gemini Flash.
 * Model: gemini-2.5-flash
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
        const imagePart = {
            inlineData: {
                mimeType: file.type,
                data: base64Data,
            },
        };
        const textPart = {
            text: prompt
        };

        const response = await aiCircuitBreaker.execute(async () => {
            return await retryWithExponentialBackoff(async () => {
                return await initializeAI().models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: { parts: [imagePart, textPart] },
                });
            }, 'Image analysis');
        });

        if (resultsContainer) resultsContainer.innerText = response.text;

    } catch (error: any) {
        logErrorWithContext(error, 'Image analysis');
        const categorized = categorizeAIError(error, 'Image analysis');
        if (resultsContainer) resultsContainer.innerText = `Error: ${categorized.userMessage}`;
        StatusManager.show(formatErrorMessage(categorized), 'error', 15000);
    } finally {
        StatusManager.showLoading(false);
    }
}

/**
 * ✨ Performs deep analysis on the document text using Gemini Pro with thinking budget.
 * Model: gemini-2.5-pro (with 32768 thinking budget)
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

        const fullPrompt = `Based on the following document text, please answer this question: ${prompt}\n\nDOCUMENT TEXT:\n${documentText}`;

        const response = await aiCircuitBreaker.execute(async () => {
            return await retryWithExponentialBackoff(async () => {
                return await initializeAI().models.generateContent({
                    model: 'gemini-2.5-pro',
                    contents: fullPrompt,
                    config: {
                        thinkingConfig: { thinkingBudget: 32768 }
                    }
                });
            }, 'Deep analysis');
        });

        if (resultsContainer) resultsContainer.innerText = response.text;

    } catch (error: any) {
        logErrorWithContext(error, 'Deep analysis');
        const categorized = categorizeAIError(error, 'Deep analysis');
        if (resultsContainer) resultsContainer.innerText = `Error: ${categorized.userMessage}`;
        StatusManager.show(formatErrorMessage(categorized), 'error', 15000);
    } finally {
        StatusManager.showLoading(false);
    }
}

// ==================== EXPORTS ====================

/**
 * AIService object - Central manager for all AI operations
 */
const AIService = {
    generatePICO,
    generateSummary,
    validateFieldWithAI,
    findMetadata,
    handleExtractTables,
    handleImageAnalysis,
    handleDeepAnalysis,
    // Helper functions (exported for potential internal use)
    getPageText,
    getAllPdfText,
    callGeminiWithSearch,
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
