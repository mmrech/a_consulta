/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import AppStateManager from '../state/AppStateManager';
import AuthManager from './AuthManager';
import BackendClient from './BackendClient';

export interface PICOResult {
    population: string;
    intervention: string;
    comparator: string;
    outcomes: string;
    timing: string;
    studyType: string;
}

export interface ValidationResult {
    is_supported: boolean;
    supporting_quote: string;
    confidence_score: number;
}

export interface MetadataResult {
    doi: string | null;
    pmid: string | null;
    journal: string | null;
    year: string | number | null;
}

export interface TableData {
    title: string;
    description?: string;
    data: string[][];
}

export interface TableResult {
    tables: TableData[];
}

type BackendResponse<T> = T | { data: T };

function unwrapResponse<T>(response: BackendResponse<T>): T {
    if (response && typeof response === 'object' && 'data' in response) {
        return (response as { data: T }).data;
    }
    return response as T;
}

function getDocumentId(): string {
    const state = AppStateManager.getState();
    return state.documentName || 'frontend-session';
}

async function ensureBackendReady(): Promise<string> {
    const authenticated = await AuthManager.ensureAuthenticated();
    if (!authenticated || !BackendClient.isAuthenticated()) {
        throw new Error('Backend AI service is unavailable. Please start the backend and configure credentials.');
    }
    return getDocumentId();
}

const AIBackendAdapter = {
    async generatePICO(pdfText: string): Promise<PICOResult> {
        const documentId = await ensureBackendReady();
        const response = await BackendClient.generatePICO(documentId, pdfText);
        return unwrapResponse<PICOResult>(response);
    },

    async generateSummary(pdfText: string): Promise<string> {
        const documentId = await ensureBackendReady();
        const response = await BackendClient.generateSummary(documentId, pdfText);
        const parsed = unwrapResponse<{ summary?: string } | string>(response);
        if (typeof parsed === 'string') return parsed;
        return parsed.summary || '';
    },

    async validateField(fieldId: string, fieldValue: string, pdfText: string): Promise<ValidationResult> {
        const documentId = await ensureBackendReady();
        const response = await BackendClient.validateField(documentId, fieldId, fieldValue, pdfText);
        return unwrapResponse<ValidationResult>(response);
    },

    async findMetadata(queryText: string): Promise<MetadataResult> {
        const documentId = await ensureBackendReady();
        const response = await BackendClient.findMetadata(documentId, queryText);
        return unwrapResponse<MetadataResult>(response);
    },

    async extractTables(pdfText: string): Promise<TableResult> {
        const documentId = await ensureBackendReady();
        const response = await BackendClient.extractTables(documentId, pdfText);
        return unwrapResponse<TableResult>(response);
    },

    async analyzeImage(imageBase64: string, mimeType: string, prompt: string): Promise<string> {
        const documentId = await ensureBackendReady();
        const response = await BackendClient.analyzeImage(documentId, imageBase64, prompt);
        const parsed = unwrapResponse<{ analysis?: string } | string>(response);
        if (typeof parsed === 'string') return parsed;
        return parsed.analysis || '';
    },

    async deepAnalysis(pdfText: string, prompt: string, documentId?: string): Promise<string> {
        const resolvedDocId = documentId || (await ensureBackendReady());
        const response = await BackendClient.deepAnalysis(resolvedDocId, pdfText, prompt);
        const parsed = unwrapResponse<{ analysis?: string } | string>(response);
        if (typeof parsed === 'string') return parsed;
        return parsed.analysis || '';
    }
};

export default AIBackendAdapter;
