/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BackendAIClient
 * Typed HTTP helper for calling backend AI endpoints.
 *
 * All requests are routed through the FastAPI backend using the
 * `VITE_BACKEND_URL` environment variable to avoid exposing API keys
 * in the browser bundle.
 */

function resolveBackendUrl(): string {
    const fromGlobal = (globalThis as any)?.__BACKEND_URL__ as string | undefined;
    const fromProcess = process.env.VITE_BACKEND_URL;

    return fromGlobal || fromProcess || 'http://localhost:8000';
}

const BACKEND_URL = resolveBackendUrl();

interface RequestOptions {
    path: string;
    body?: Record<string, unknown>;
}

interface BackendErrorPayload {
    detail?: string;
    message?: string;
}

export interface PICOResponse {
    population: string;
    intervention: string;
    comparator: string;
    outcomes: string;
    timing: string;
    study_type?: string;
    studyType?: string;
}

export interface SummaryResponse {
    summary: string;
}

export interface ValidationResponse {
    is_supported: boolean;
    supporting_quote: string;
    confidence_score: number;
}

export interface MetadataResponse {
    doi?: string | null;
    pmid?: string | null;
    journal?: string | null;
    year?: number | string | null;
}

export interface TableData {
    title: string;
    description?: string;
    data: string[][];
}

export interface TableExtractionResponse {
    tables: TableData[];
}

export interface ImageAnalysisResponse {
    analysis: string;
}

export interface DeepAnalysisResponse {
    analysis: string;
}

function buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    const token = typeof localStorage !== 'undefined'
        ? localStorage.getItem('la_consulta_access_token')
        : null;

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
}

async function request<T>({ path, body }: RequestOptions): Promise<T> {
    const response = await fetch(`${BACKEND_URL}${path}`, {
        method: 'POST',
        headers: buildHeaders(),
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
        let errorDetail = `Request to ${path} failed`;
        try {
            const errorBody = (await response.json()) as BackendErrorPayload;
            errorDetail = errorBody.detail || errorBody.message || errorDetail;
        } catch {
            const text = await response.text().catch(() => '');
            if (text) {
                errorDetail = text;
            }
        }
        throw new Error(errorDetail);
    }

    return (await response.json()) as T;
}

async function getHealth(): Promise<boolean> {
    try {
        const response = await fetch(`${BACKEND_URL}/health`, { method: 'GET' });
        return response.ok;
    } catch {
        return false;
    }
}

const BackendAIClient = {
    async generatePICO(pdfText: string, documentId?: string): Promise<PICOResponse> {
        return request<PICOResponse>({
            path: '/api/ai/generate-pico',
            body: { document_id: documentId, pdf_text: pdfText },
        });
    },

    async generateSummary(pdfText: string, documentId?: string): Promise<SummaryResponse> {
        return request<SummaryResponse>({
            path: '/api/ai/generate-summary',
            body: { document_id: documentId, pdf_text: pdfText },
        });
    },

    async validateField(
        fieldId: string,
        fieldValue: string,
        pdfText: string,
        documentId?: string,
    ): Promise<ValidationResponse> {
        return request<ValidationResponse>({
            path: '/api/ai/validate-field',
            body: { document_id: documentId, field_id: fieldId, field_value: fieldValue, pdf_text: pdfText },
        });
    },

    async findMetadata(pdfText: string, documentId?: string): Promise<MetadataResponse> {
        return request<MetadataResponse>({
            path: '/api/ai/find-metadata',
            body: { document_id: documentId, pdf_text: pdfText },
        });
    },

    async extractTables(pdfText: string, documentId?: string): Promise<TableExtractionResponse> {
        return request<TableExtractionResponse>({
            path: '/api/ai/extract-tables',
            body: { document_id: documentId, pdf_text: pdfText },
        });
    },

    async analyzeImage(imageBase64: string, mimeType: string, prompt: string, documentId?: string): Promise<ImageAnalysisResponse> {
        return request<ImageAnalysisResponse>({
            path: '/api/ai/analyze-image',
            body: { document_id: documentId, image_base64: imageBase64, mime_type: mimeType, prompt },
        });
    },

    async deepAnalysis(pdfText: string, prompt: string, documentId?: string): Promise<DeepAnalysisResponse> {
        return request<DeepAnalysisResponse>({
            path: '/api/ai/deep-analysis',
            body: { document_id: documentId, pdf_text: pdfText, prompt },
        });
    },

    async healthCheck(): Promise<boolean> {
        return getHealth();
    },
};

export default BackendAIClient;
