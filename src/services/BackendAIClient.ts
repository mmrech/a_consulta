/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BackendAIClient - Backend API client for AI operations
 *
 * Provides typed interfaces for all 7 AI functions via backend API proxy.
 * This client is the PRIMARY route for AI operations, with direct Gemini
 * calls serving as FALLBACK when backend is unavailable.
 *
 * Architecture:
 * - Uses BackendProxyService for robust HTTP requests
 * - Automatic retry with exponential backoff
 * - Request caching for performance
 * - Rate limiting to prevent throttling
 *
 * Usage:
 * ```typescript
 * import BackendAIClient from './BackendAIClient';
 *
 * try {
 *     const result = await BackendAIClient.generatePICO(pdfText);
 *     // Handle success
 * } catch (error) {
 *     // Fallback to direct Gemini call
 * }
 * ```
 */

import { BackendProxyService } from './BackendProxyService';
import type {
    PICOResult,
    SummaryResult,
    AIValidationResult,
    MetadataResult,
    TablesResult,
    ImageAnalysisResult,
    DeepAnalysisResult
} from '../types';

// ==================== BACKEND AI CLIENT ====================

/**
 * BackendAIClient - Static class for backend AI operations
 */
export class BackendAIClient {
    private static baseURL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

    /**
     * Generate PICO-T summary from PDF text
     * Endpoint: POST /api/ai/generate-pico
     * Model: gemini-2.5-flash
     */
    static async generatePICO(pdfText: string): Promise<PICOResult> {
        const response = await BackendProxyService.request<PICOResult>({
            url: `${this.baseURL}/api/ai/generate-pico`,
            method: 'POST',
            body: { pdfText },
            cache: true,
            timeout: 60000, // 60s timeout for large documents
        });

        return response.data;
    }

    /**
     * Generate summary of key findings from PDF text
     * Endpoint: POST /api/ai/generate-summary
     * Model: gemini-flash-latest
     */
    static async generateSummary(pdfText: string): Promise<SummaryResult> {
        const response = await BackendProxyService.request<SummaryResult>({
            url: `${this.baseURL}/api/ai/generate-summary`,
            method: 'POST',
            body: { pdfText },
            cache: true,
            timeout: 60000,
        });

        return response.data;
    }

    /**
     * Validate field content against PDF text
     * Endpoint: POST /api/ai/validate-field
     * Model: gemini-2.5-pro
     */
    static async validateField(
        fieldId: string,
        fieldValue: string,
        pdfText: string
    ): Promise<AIValidationResult> {
        const response = await BackendProxyService.request<AIValidationResult>({
            url: `${this.baseURL}/api/ai/validate-field`,
            method: 'POST',
            body: { fieldId, fieldValue, pdfText },
            cache: false, // Don't cache validations (dynamic content)
            timeout: 30000, // 30s timeout
        });

        return response.data;
    }

    /**
     * Search for study metadata using citation text
     * Endpoint: POST /api/ai/find-metadata
     * Model: gemini-2.5-flash + Google Search grounding
     */
    static async findMetadata(citationText: string): Promise<MetadataResult> {
        const response = await BackendProxyService.request<MetadataResult>({
            url: `${this.baseURL}/api/ai/find-metadata`,
            method: 'POST',
            body: { citationText },
            cache: true,
            timeout: 45000, // 45s timeout (includes search time)
        });

        return response.data;
    }

    /**
     * Extract tables from PDF text
     * Endpoint: POST /api/ai/extract-tables
     * Model: gemini-2.5-pro
     */
    static async extractTables(pdfText: string): Promise<TablesResult> {
        const response = await BackendProxyService.request<TablesResult>({
            url: `${this.baseURL}/api/ai/extract-tables`,
            method: 'POST',
            body: { pdfText },
            cache: true,
            timeout: 90000, // 90s timeout (complex extraction)
        });

        return response.data;
    }

    /**
     * Analyze image with custom prompt
     * Endpoint: POST /api/ai/analyze-image
     * Model: gemini-2.5-flash
     */
    static async analyzeImage(
        imageBase64: string,
        prompt: string
    ): Promise<ImageAnalysisResult> {
        const response = await BackendProxyService.request<ImageAnalysisResult>({
            url: `${this.baseURL}/api/ai/analyze-image`,
            method: 'POST',
            body: { imageBase64, prompt },
            cache: false, // Don't cache image analysis (large payloads)
            timeout: 60000,
        });

        return response.data;
    }

    /**
     * Perform deep analysis with extended thinking
     * Endpoint: POST /api/ai/deep-analysis
     * Model: gemini-2.5-pro (with thinking budget: 32768)
     */
    static async deepAnalysis(
        pdfText: string,
        analysisType: string
    ): Promise<DeepAnalysisResult> {
        const response = await BackendProxyService.request<DeepAnalysisResult>({
            url: `${this.baseURL}/api/ai/deep-analysis`,
            method: 'POST',
            body: { pdfText, analysisType },
            cache: true,
            timeout: 120000, // 120s timeout (deep thinking)
        });

        return response.data;
    }

    /**
     * Health check for backend AI service
     * Endpoint: GET /api/ai/health
     */
    static async healthCheck(): Promise<boolean> {
        try {
            const response = await BackendProxyService.request<{ status: string }>({
                url: `${this.baseURL}/api/ai/health`,
                method: 'GET',
                timeout: 5000, // 5s timeout
                cache: false,
            });

            return response.status === 200 && response.data.status === 'ok';
        } catch (error) {
            console.warn('Backend AI health check failed:', error);
            return false;
        }
    }

    /**
     * Configure backend URL (useful for testing or environment switching)
     */
    static configure(baseURL: string): void {
        this.baseURL = baseURL;
    }
}

export default BackendAIClient;
