/**
 * Citation Sidebar Component
 * Displays citations from AI responses with jump links to PDF locations
 */

import { citationAPIClient } from '../services/CitationAPIClient'
import { CitationService } from '../services/CitationService'
import { AppStateManager } from '../state/AppStateManager'

interface Citation {
    text: string
    page_number?: number
    confidence?: number
    // Added for UI tracking
    id?: string
    highlighted?: boolean
}

export class CitationSidebar {
    private container: HTMLElement
    private isVisible: boolean = false
    private currentCitations: Citation[] = []
    private citationService: CitationService
    private appState: AppStateManager
    private fileSearchStoreId: string | null = null

    constructor(containerId: string = 'citation-sidebar') {
        // Create sidebar container if doesn't exist
        let container = document.getElementById(containerId)
        if (!container) {
            container = document.createElement('div')
            container.id = containerId
            container.className = 'citation-sidebar'
            document.body.appendChild(container)
        }
        this.container = container
        this.citationService = CitationService.getInstance()
        this.appState = AppStateManager.getInstance()
        
        this.setupStyles()
        this.render()
        this.setupEventListeners()
    }

    private setupStyles() {
        if (!document.getElementById('citation-sidebar-styles')) {
            const style = document.createElement('style')
            style.id = 'citation-sidebar-styles'
            style.textContent = `
                .citation-sidebar {
                    position: fixed;
                    right: ${this.isVisible ? '0' : '-400px'};
                    top: 60px;
                    width: 400px;
                    height: calc(100vh - 60px);
                    background: white;
                    box-shadow: -2px 0 10px rgba(0, 0, 0, 0.1);
                    transition: right 0.3s ease;
                    z-index: 1000;
                    overflow-y: auto;
                    padding: 20px;
                }
                
                .citation-sidebar.visible {
                    right: 0;
                }
                
                .citation-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    padding-bottom: 15px;
                    border-bottom: 2px solid #e5e7eb;
                }
                
                .citation-title {
                    font-size: 20px;
                    font-weight: 600;
                    color: #111827;
                }
                
                .citation-toggle {
                    position: fixed;
                    right: 10px;
                    top: 80px;
                    background: #3b82f6;
                    color: white;
                    border: none;
                    border-radius: 8px 0 0 8px;
                    padding: 10px 15px;
                    cursor: pointer;
                    z-index: 999;
                    box-shadow: -2px 2px 5px rgba(0, 0, 0, 0.1);
                }
                
                .citation-toggle:hover {
                    background: #2563eb;
                }
                
                .close-btn {
                    background: none;
                    border: none;
                    font-size: 24px;
                    cursor: pointer;
                    color: #6b7280;
                }
                
                .close-btn:hover {
                    color: #111827;
                }
                
                .query-section {
                    margin-bottom: 25px;
                }
                
                .query-input-wrapper {
                    display: flex;
                    gap: 10px;
                }
                
                .query-input {
                    flex: 1;
                    padding: 10px;
                    border: 1px solid #d1d5db;
                    border-radius: 8px;
                    font-size: 14px;
                }
                
                .query-btn {
                    background: #3b82f6;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    padding: 10px 20px;
                    cursor: pointer;
                    font-weight: 500;
                }
                
                .query-btn:hover {
                    background: #2563eb;
                }
                
                .query-btn:disabled {
                    background: #9ca3af;
                    cursor: not-allowed;
                }
                
                .upload-section {
                    background: #f9fafb;
                    border: 2px dashed #d1d5db;
                    border-radius: 8px;
                    padding: 15px;
                    margin-bottom: 20px;
                    text-align: center;
                }
                
                .upload-btn {
                    background: #10b981;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    padding: 10px 20px;
                    cursor: pointer;
                    font-weight: 500;
                    margin-top: 10px;
                }
                
                .upload-btn:hover {
                    background: #059669;
                }
                
                .upload-status {
                    margin-top: 10px;
                    font-size: 13px;
                }
                
                .upload-status.success {
                    color: #10b981;
                }
                
                .upload-status.error {
                    color: #ef4444;
                }
                
                .answer-section {
                    background: #f3f4f6;
                    border-radius: 8px;
                    padding: 15px;
                    margin-bottom: 20px;
                }
                
                .answer-text {
                    font-size: 14px;
                    line-height: 1.6;
                    color: #374151;
                }
                
                .citations-list {
                    display: flex;
                    flex-direction: column;
                    gap: 15px;
                }
                
                .citation-item {
                    background: #f9fafb;
                    border: 1px solid #e5e7eb;
                    border-radius: 8px;
                    padding: 15px;
                    transition: all 0.2s;
                    cursor: pointer;
                }
                
                .citation-item:hover {
                    background: #f3f4f6;
                    border-color: #3b82f6;
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
                }
                
                .citation-item.highlighted {
                    background: #fef3c7;
                    border-color: #f59e0b;
                }
                
                .citation-number {
                    display: inline-block;
                    background: #3b82f6;
                    color: white;
                    border-radius: 50%;
                    width: 24px;
                    height: 24px;
                    text-align: center;
                    line-height: 24px;
                    font-size: 12px;
                    font-weight: 600;
                    margin-right: 10px;
                }
                
                .citation-text {
                    font-size: 13px;
                    line-height: 1.5;
                    color: #374151;
                    margin-bottom: 8px;
                }
                
                .citation-meta {
                    display: flex;
                    gap: 15px;
                    font-size: 12px;
                    color: #6b7280;
                }
                
                .citation-page {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                }
                
                .citation-confidence {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                }
                
                .empty-state {
                    text-align: center;
                    padding: 40px 20px;
                    color: #6b7280;
                }
                
                .loading-spinner {
                    border: 3px solid #f3f4f6;
                    border-top: 3px solid #3b82f6;
                    border-radius: 50%;
                    width: 30px;
                    height: 30px;
                    animation: spin 1s linear infinite;
                    margin: 20px auto;
                }
                
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `
            document.head.appendChild(style)
        }
    }

    private render() {
        this.container.innerHTML = `
            <button class="citation-toggle" id="citation-toggle-btn">
                📚 Citations
            </button>
            
            <div class="citation-header">
                <h2 class="citation-title">Citations & References</h2>
                <button class="close-btn" id="close-sidebar-btn">×</button>
            </div>
            
            <div class="upload-section" id="upload-section">
                <p>📄 Upload current PDF to enable citations</p>
                <button class="upload-btn" id="upload-pdf-btn">Upload PDF</button>
                <div class="upload-status" id="upload-status"></div>
            </div>
            
            <div class="query-section">
                <div class="query-input-wrapper">
                    <input 
                        type="text" 
                        class="query-input" 
                        id="query-input" 
                        placeholder="Ask a question about the document..."
                        disabled
                    />
                    <button class="query-btn" id="query-btn" disabled>Ask</button>
                </div>
            </div>
            
            <div class="answer-section" id="answer-section" style="display: none;">
                <h3 style="font-weight: 600; margin-bottom: 10px;">Answer:</h3>
                <div class="answer-text" id="answer-text"></div>
            </div>
            
            <div id="citations-container">
                <div class="empty-state">
                    Upload a PDF and ask a question to see citations
                </div>
            </div>
        `
        
        this.container.className = `citation-sidebar ${this.isVisible ? 'visible' : ''}`
    }

    private setupEventListeners() {
        // Toggle sidebar visibility
        const toggleBtn = document.getElementById('citation-toggle-btn')
        const closeBtn = document.getElementById('close-sidebar-btn')
        
        toggleBtn?.addEventListener('click', () => {
            this.toggle()
        })
        
        closeBtn?.addEventListener('click', () => {
            this.hide()
        })
        
        // Upload PDF button
        const uploadBtn = document.getElementById('upload-pdf-btn')
        uploadBtn?.addEventListener('click', () => {
            this.handlePDFUpload()
        })
        
        // Query button and input
        const queryBtn = document.getElementById('query-btn')
        const queryInput = document.getElementById('query-input') as HTMLInputElement
        
        queryBtn?.addEventListener('click', () => {
            this.handleQuery(queryInput.value)
        })
        
        queryInput?.addEventListener('keypress', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !queryBtn?.hasAttribute('disabled')) {
                this.handleQuery(queryInput.value)
            }
        })
    }

    private async handlePDFUpload() {
        const uploadBtn = document.getElementById('upload-pdf-btn') as HTMLButtonElement
        const uploadStatus = document.getElementById('upload-status')
        const queryInput = document.getElementById('query-input') as HTMLInputElement
        const queryBtn = document.getElementById('query-btn') as HTMLButtonElement
        
        // Get current PDF data from AppState
        const pdfData = this.appState.getCurrentPDFData()
        if (!pdfData) {
            if (uploadStatus) {
                uploadStatus.className = 'upload-status error'
                uploadStatus.textContent = 'No PDF loaded. Please load a PDF first.'
            }
            return
        }
        
        // Show loading state
        if (uploadBtn) {
            uploadBtn.disabled = true
            uploadBtn.textContent = 'Uploading...'
        }
        
        try {
            const response = await citationAPIClient.uploadPDFForCitations(
                pdfData.documentId || 'doc-' + Date.now(),
                pdfData.base64Data,
                pdfData.fileName || 'document.pdf'
            )
            
            this.fileSearchStoreId = response.file_search_store_id
            
            // Update UI on success
            if (uploadStatus) {
                uploadStatus.className = 'upload-status success'
                uploadStatus.textContent = '✓ PDF uploaded successfully'
            }
            
            if (uploadBtn) {
                uploadBtn.textContent = 'Re-upload PDF'
                uploadBtn.disabled = false
            }
            
            // Enable query input
            if (queryInput && queryBtn) {
                queryInput.disabled = false
                queryBtn.disabled = false
            }
            
            // Hide upload section after success
            setTimeout(() => {
                const uploadSection = document.getElementById('upload-section')
                if (uploadSection) {
                    uploadSection.style.display = 'none'
                }
            }, 2000)
            
        } catch (error) {
            if (uploadStatus) {
                uploadStatus.className = 'upload-status error'
                uploadStatus.textContent = `✗ Upload failed: ${error}`
            }
            
            if (uploadBtn) {
                uploadBtn.textContent = 'Upload PDF'
                uploadBtn.disabled = false
            }
            
            console.error('Failed to upload PDF:', error)
        }
    }

    private async handleQuery(query: string) {
        if (!query.trim() || !this.fileSearchStoreId) {
            return
        }
        
        const queryBtn = document.getElementById('query-btn') as HTMLButtonElement
        const citationsContainer = document.getElementById('citations-container')
        const answerSection = document.getElementById('answer-section')
        const answerText = document.getElementById('answer-text')
        
        // Show loading state
        if (queryBtn) {
            queryBtn.disabled = true
            queryBtn.textContent = 'Searching...'
        }
        
        if (citationsContainer) {
            citationsContainer.innerHTML = '<div class="loading-spinner"></div>'
        }
        
        try {
            const response = await citationAPIClient.queryWithCitations(
                this.appState.getCurrentPDFData()?.documentId || 'doc-' + Date.now(),
                this.fileSearchStoreId,
                query
            )
            
            // Display answer
            if (answerSection && answerText) {
                answerSection.style.display = 'block'
                answerText.textContent = response.answer
            }
            
            // Display citations
            this.currentCitations = response.citations.map((c, i) => ({
                ...c,
                id: `citation-${i + 1}`
            }))
            
            this.renderCitations()
            
        } catch (error) {
            if (citationsContainer) {
                citationsContainer.innerHTML = `
                    <div class="empty-state">
                        ✗ Failed to get citations: ${error}
                    </div>
                `
            }
            console.error('Failed to query with citations:', error)
            
        } finally {
            if (queryBtn) {
                queryBtn.disabled = false
                queryBtn.textContent = 'Ask'
            }
        }
    }

    private renderCitations() {
        const container = document.getElementById('citations-container')
        if (!container) return
        
        if (this.currentCitations.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    No citations found for this query
                </div>
            `
            return
        }
        
        const citationsHTML = this.currentCitations.map((citation, index) => `
            <div class="citation-item" data-citation-id="${citation.id}">
                <div>
                    <span class="citation-number">${index + 1}</span>
                    <span class="citation-text">"${citation.text}"</span>
                </div>
                <div class="citation-meta">
                    ${citation.page_number ? `
                        <div class="citation-page">
                            📄 Page ${citation.page_number}
                        </div>
                    ` : ''}
                    ${citation.confidence ? `
                        <div class="citation-confidence">
                            🎯 ${Math.round(citation.confidence * 100)}% confidence
                        </div>
                    ` : ''}
                </div>
            </div>
        `).join('')
        
        container.innerHTML = `
            <h3 style="font-weight: 600; margin-bottom: 15px;">Citations (${this.currentCitations.length})</h3>
            <div class="citations-list">
                ${citationsHTML}
            </div>
        `
        
        // Add click handlers for jump links
        container.querySelectorAll('.citation-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const citationId = (e.currentTarget as HTMLElement).dataset.citationId
                const citation = this.currentCitations.find(c => c.id === citationId)
                if (citation) {
                    this.jumpToCitation(citation)
                }
            })
        })
    }

    private async jumpToCitation(citation: Citation) {
        // Highlight citation in sidebar
        document.querySelectorAll('.citation-item').forEach(item => {
            item.classList.remove('highlighted')
        })
        
        const currentItem = document.querySelector(`[data-citation-id="${citation.id}"]`)
        currentItem?.classList.add('highlighted')
        
        // Use CitationService to jump to text in PDF
        if (citation.text && this.citationService) {
            try {
                // Search for the cited text in the PDF
                const searchResults = await this.citationService.searchText(citation.text)
                
                if (searchResults && searchResults.length > 0) {
                    // Jump to the first occurrence (or use page number if available)
                    let targetResult = searchResults[0]
                    
                    if (citation.page_number) {
                        // Find result on the specific page if available
                        const pageResult = searchResults.find(r => r.pageNumber === citation.page_number)
                        if (pageResult) {
                            targetResult = pageResult
                        }
                    }
                    
                    // Scroll to the citation in the PDF
                    await this.citationService.scrollToCitation({
                        pageNumber: targetResult.pageNumber,
                        x: targetResult.x,
                        y: targetResult.y,
                        width: targetResult.width,
                        height: targetResult.height,
                        text: citation.text
                    })
                    
                    // Flash highlight effect
                    setTimeout(() => {
                        currentItem?.classList.remove('highlighted')
                    }, 2000)
                    
                } else {
                    console.warn('Citation text not found in PDF:', citation.text)
                }
                
            } catch (error) {
                console.error('Failed to jump to citation:', error)
            }
        }
    }

    public show() {
        this.isVisible = true
        this.container.classList.add('visible')
    }

    public hide() {
        this.isVisible = false
        this.container.classList.remove('visible')
    }

    public toggle() {
        if (this.isVisible) {
            this.hide()
        } else {
            this.show()
        }
    }

    public clearCitations() {
        this.currentCitations = []
        const container = document.getElementById('citations-container')
        if (container) {
            container.innerHTML = `
                <div class="empty-state">
                    Upload a PDF and ask a question to see citations
                </div>
            `
        }
        
        // Reset answer section
        const answerSection = document.getElementById('answer-section')
        if (answerSection) {
            answerSection.style.display = 'none'
        }
        
        // Reset file search store
        this.fileSearchStoreId = null
        
        // Show upload section
        const uploadSection = document.getElementById('upload-section')
        if (uploadSection) {
            uploadSection.style.display = 'block'
        }
        
        // Disable query input
        const queryInput = document.getElementById('query-input') as HTMLInputElement
        const queryBtn = document.getElementById('query-btn') as HTMLButtonElement
        if (queryInput && queryBtn) {
            queryInput.disabled = true
            queryBtn.disabled = true
        }
    }
}

// Export singleton instance
let citationSidebarInstance: CitationSidebar | null = null

export function getCitationSidebar(): CitationSidebar {
    if (!citationSidebarInstance) {
        citationSidebarInstance = new CitationSidebar()
    }
    return citationSidebarInstance
}