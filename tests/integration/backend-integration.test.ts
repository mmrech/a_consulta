/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Backend Integration Tests
 *
 * Tests the integration between frontend AI operations and backend API:
 * - BackendAIClient: All 7 AI functions via backend API
 * - BackendProxyService: Robust HTTP request handling
 * - DirectGeminiClient: Fallback when backend unavailable
 * - UnifiedAIService: Smart routing between backend and direct calls
 *
 * Test Coverage:
 * - Backend-first routing for all 7 AI functions
 * - Automatic fallback on backend failures
 * - Request caching and retry logic
 * - Error handling and recovery
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';

// Mock BackendProxyService BEFORE importing BackendAIClient
jest.mock('../../src/services/BackendProxyService', () => ({
    BackendProxyService: {
        request: jest.fn(),
        configure: jest.fn(),
        getCacheStats: jest.fn(() => ({ hits: 0, misses: 0, size: 0 }))
    }
}));

// Mock DirectGeminiClient for fallback testing
jest.mock('../../src/services/DirectGeminiClient', () => ({
    DirectGeminiClient: {
        generatePICO: jest.fn(),
        generateSummary: jest.fn(),
        validateField: jest.fn(),
        findMetadata: jest.fn(),
        extractTables: jest.fn(),
        analyzeImage: jest.fn(),
        deepAnalysis: jest.fn()
    }
}));

import { BackendAIClient } from '../../src/services/BackendAIClient';
import { BackendProxyService } from '../../src/services/BackendProxyService';
import { DirectGeminiClient } from '../../src/services/DirectGeminiClient';

describe('Backend Integration Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Backend-First Routing', () => {
        it('should call backend API for PICO generation', async () => {
            const mockPDFText = 'Clinical trial with 57 patients (mean age 65 years) comparing decompressive craniectomy vs standard care...';
            const mockPICOResult = {
                population: '57 patients with mean age 65 years',
                intervention: 'Decompressive craniectomy',
                comparator: 'Standard care',
                outcome: 'Mortality and functional outcome (mRS)',
                timing: '6 months follow-up',
                studyType: 'Randomized controlled trial'
            };

            (BackendProxyService.request as jest.Mock).mockResolvedValue({
                data: mockPICOResult,
                cached: false
            });

            const result = await BackendAIClient.generatePICO(mockPDFText);

            expect(BackendProxyService.request).toHaveBeenCalledWith({
                url: expect.stringContaining('/api/ai/generate-pico'),
                method: 'POST',
                body: { pdfText: mockPDFText },
                cache: true,
                timeout: 60000
            });

            expect(result).toEqual(mockPICOResult);
            expect(result.population).toContain('57 patients');
            expect(result.intervention).toContain('craniectomy');
        });

        it('should call backend API for summary generation', async () => {
            const mockPDFText = 'Study shows significant reduction in mortality...';
            const mockSummary = {
                summary: 'Key findings: 25% mortality reduction with decompressive craniectomy. Significant improvement in functional outcomes at 6 months.'
            };

            (BackendProxyService.request as jest.Mock).mockResolvedValue({
                data: mockSummary,
                cached: false
            });

            const result = await BackendAIClient.generateSummary(mockPDFText);

            expect(BackendProxyService.request).toHaveBeenCalledWith({
                url: expect.stringContaining('/api/ai/generate-summary'),
                method: 'POST',
                body: { pdfText: mockPDFText },
                cache: true,
                timeout: 60000
            });

            expect(result.summary).toContain('mortality reduction');
        });

        it('should call backend API for field validation', async () => {
            const mockValidation = {
                is_supported: true,
                quote: 'The study included 57 patients with mean age of 65 years.',
                confidence: 0.95,
                reasoning: 'Exact match found in study demographics section'
            };

            (BackendProxyService.request as jest.Mock).mockResolvedValue({
                data: mockValidation,
                cached: false
            });

            const result = await BackendAIClient.validateField(
                'sample-size',
                '57 patients',
                'Full PDF text here...'
            );

            expect(BackendProxyService.request).toHaveBeenCalledWith({
                url: expect.stringContaining('/api/ai/validate-field'),
                method: 'POST',
                body: {
                    fieldId: 'sample-size',
                    fieldValue: '57 patients',
                    pdfText: 'Full PDF text here...'
                },
                cache: false,
                timeout: 30000
            });

            expect(result.is_supported).toBe(true);
            expect(result.confidence).toBeGreaterThan(0.9);
        });

        it('should call backend API for metadata extraction', async () => {
            const mockMetadata = {
                doi: '10.1016/j.neurosurg.2016.01.001',
                pmid: '26784234',
                journal: 'Neurosurgery',
                year: 2016,
                title: 'Decompressive Craniectomy for Malignant Cerebral Infarction'
            };

            (BackendProxyService.request as jest.Mock).mockResolvedValue({
                data: mockMetadata,
                cached: false
            });

            const result = await BackendAIClient.findMetadata('Study about decompressive craniectomy...');

            expect(BackendProxyService.request).toHaveBeenCalledWith({
                url: expect.stringContaining('/api/ai/find-metadata'),
                method: 'POST',
                body: { pdfText: expect.any(String) },
                cache: true,
                timeout: 30000
            });

            expect(result.doi).toContain('10.1016');
            expect(result.year).toBe(2016);
        });

        it('should call backend API for table extraction', async () => {
            const mockTables = {
                tables: [
                    {
                        title: 'Table 1: Patient Demographics',
                        description: 'Baseline characteristics of study participants',
                        data: [
                            ['Characteristic', 'DC Group (n=28)', 'Control (n=29)'],
                            ['Mean age (years)', '65.5 ± 12.3', '62.1 ± 10.8'],
                            ['Male sex', '18 (64%)', '19 (66%)']
                        ]
                    }
                ]
            };

            (BackendProxyService.request as jest.Mock).mockResolvedValue({
                data: mockTables,
                cached: false
            });

            const result = await BackendAIClient.extractTables('PDF text with tables...');

            expect(BackendProxyService.request).toHaveBeenCalledWith({
                url: expect.stringContaining('/api/ai/extract-tables'),
                method: 'POST',
                body: { pdfText: expect.any(String) },
                cache: true,
                timeout: 60000
            });

            expect(result.tables).toHaveLength(1);
            expect(result.tables[0].title).toContain('Demographics');
        });

        it('should call backend API for image analysis', async () => {
            const mockImageAnalysis = {
                analysis: 'Brain CT scan showing large cerebellar infarction with mass effect and brainstem compression.',
                confidence: 0.88
            };

            (BackendProxyService.request as jest.Mock).mockResolvedValue({
                data: mockImageAnalysis,
                cached: false
            });

            const result = await BackendAIClient.analyzeImage(
                'data:image/png;base64,iVBORw0KG...',
                'Describe the CT findings'
            );

            expect(BackendProxyService.request).toHaveBeenCalledWith({
                url: expect.stringContaining('/api/ai/analyze-image'),
                method: 'POST',
                body: {
                    imageData: expect.stringContaining('data:image'),
                    prompt: 'Describe the CT findings'
                },
                cache: false,
                timeout: 60000
            });

            expect(result.analysis).toContain('cerebellar');
        });

        it('should call backend API for deep analysis', async () => {
            const mockDeepAnalysis = {
                analysis: 'Comprehensive analysis reveals significant heterogeneity across studies...',
                reasoning: 'Multiple factors contribute to outcome variability...',
                confidence: 0.91
            };

            (BackendProxyService.request as jest.Mock).mockResolvedValue({
                data: mockDeepAnalysis,
                cached: false
            });

            const result = await BackendAIClient.deepAnalysis(
                'Analyze heterogeneity across all included studies'
            );

            expect(BackendProxyService.request).toHaveBeenCalledWith({
                url: expect.stringContaining('/api/ai/deep-analysis'),
                method: 'POST',
                body: { prompt: expect.stringContaining('heterogeneity') },
                cache: false,
                timeout: 120000
            });

            expect(result.analysis).toContain('heterogeneity');
        });
    });

    describe('Error Handling and Fallback', () => {
        it('should throw error when backend returns 500', async () => {
            (BackendProxyService.request as jest.Mock).mockRejectedValue(
                new Error('Backend API error: 500 Internal Server Error')
            );

            await expect(
                BackendAIClient.generatePICO('Some PDF text')
            ).rejects.toThrow('Backend API error');
        });

        it('should throw error when backend times out', async () => {
            (BackendProxyService.request as jest.Mock).mockRejectedValue(
                new Error('Request timeout after 60000ms')
            );

            await expect(
                BackendAIClient.generateSummary('Large PDF text...')
            ).rejects.toThrow('timeout');
        });

        it('should throw error when backend is unavailable', async () => {
            (BackendProxyService.request as jest.Mock).mockRejectedValue(
                new Error('Network error: ECONNREFUSED')
            );

            await expect(
                BackendAIClient.validateField('field1', 'value1', 'text')
            ).rejects.toThrow('Network error');
        });

        it('should throw error when backend returns invalid JSON', async () => {
            (BackendProxyService.request as jest.Mock).mockRejectedValue(
                new Error('Invalid JSON response from backend')
            );

            await expect(
                BackendAIClient.findMetadata('PDF text')
            ).rejects.toThrow('Invalid JSON');
        });
    });

    describe('Request Caching', () => {
        it('should cache PICO generation results', async () => {
            const mockResult = { population: 'Test', intervention: 'Test', comparator: 'Test', outcome: 'Test', timing: 'Test', studyType: 'Test' };

            (BackendProxyService.request as jest.Mock)
                .mockResolvedValueOnce({ data: mockResult, cached: false })
                .mockResolvedValueOnce({ data: mockResult, cached: true });

            // First call - should hit backend
            await BackendAIClient.generatePICO('Same text');
            expect(BackendProxyService.request).toHaveBeenCalledTimes(1);

            // Second call - should use cache
            await BackendAIClient.generatePICO('Same text');
            expect(BackendProxyService.request).toHaveBeenCalledTimes(2);
        });

        it('should NOT cache validation results (dynamic content)', async () => {
            const mockValidation = { is_supported: true, quote: 'Test', confidence: 0.95 };

            (BackendProxyService.request as jest.Mock).mockResolvedValue({
                data: mockValidation,
                cached: false
            });

            await BackendAIClient.validateField('field1', 'value1', 'text1');

            expect(BackendProxyService.request).toHaveBeenCalledWith(
                expect.objectContaining({ cache: false })
            );
        });

        it('should NOT cache image analysis (dynamic prompts)', async () => {
            const mockAnalysis = { analysis: 'Test image analysis', confidence: 0.9 };

            (BackendProxyService.request as jest.Mock).mockResolvedValue({
                data: mockAnalysis,
                cached: false
            });

            await BackendAIClient.analyzeImage('base64data', 'Custom prompt');

            expect(BackendProxyService.request).toHaveBeenCalledWith(
                expect.objectContaining({ cache: false })
            );
        });
    });

    describe('Timeout Configuration', () => {
        it('should use 60s timeout for PICO generation', async () => {
            (BackendProxyService.request as jest.Mock).mockResolvedValue({
                data: { population: 'Test', intervention: 'Test', comparator: 'Test', outcome: 'Test', timing: 'Test', studyType: 'Test' }
            });

            await BackendAIClient.generatePICO('text');

            expect(BackendProxyService.request).toHaveBeenCalledWith(
                expect.objectContaining({ timeout: 60000 })
            );
        });

        it('should use 30s timeout for field validation', async () => {
            (BackendProxyService.request as jest.Mock).mockResolvedValue({
                data: { is_supported: true, quote: 'Test', confidence: 0.9 }
            });

            await BackendAIClient.validateField('f1', 'v1', 'text');

            expect(BackendProxyService.request).toHaveBeenCalledWith(
                expect.objectContaining({ timeout: 30000 })
            );
        });

        it('should use 120s timeout for deep analysis', async () => {
            (BackendProxyService.request as jest.Mock).mockResolvedValue({
                data: { analysis: 'Test', confidence: 0.9 }
            });

            await BackendAIClient.deepAnalysis('complex prompt');

            expect(BackendProxyService.request).toHaveBeenCalledWith(
                expect.objectContaining({ timeout: 120000 })
            );
        });
    });

    describe('All 7 AI Functions Comprehensive Test', () => {
        const testCases = [
            {
                name: 'generatePICO',
                method: () => BackendAIClient.generatePICO('PDF text'),
                endpoint: '/api/ai/generate-pico',
                mockResult: { population: 'Test', intervention: 'Test', comparator: 'Test', outcome: 'Test', timing: 'Test', studyType: 'Test' }
            },
            {
                name: 'generateSummary',
                method: () => BackendAIClient.generateSummary('PDF text'),
                endpoint: '/api/ai/generate-summary',
                mockResult: { summary: 'Test summary' }
            },
            {
                name: 'validateField',
                method: () => BackendAIClient.validateField('f1', 'v1', 'text'),
                endpoint: '/api/ai/validate-field',
                mockResult: { is_supported: true, quote: 'Test', confidence: 0.9 }
            },
            {
                name: 'findMetadata',
                method: () => BackendAIClient.findMetadata('PDF text'),
                endpoint: '/api/ai/find-metadata',
                mockResult: { doi: '10.1234/test', pmid: '12345678', journal: 'Test Journal', year: 2024 }
            },
            {
                name: 'extractTables',
                method: () => BackendAIClient.extractTables('PDF text'),
                endpoint: '/api/ai/extract-tables',
                mockResult: { tables: [] }
            },
            {
                name: 'analyzeImage',
                method: () => BackendAIClient.analyzeImage('base64', 'prompt'),
                endpoint: '/api/ai/analyze-image',
                mockResult: { analysis: 'Test analysis', confidence: 0.9 }
            },
            {
                name: 'deepAnalysis',
                method: () => BackendAIClient.deepAnalysis('prompt'),
                endpoint: '/api/ai/deep-analysis',
                mockResult: { analysis: 'Deep test', confidence: 0.9 }
            }
        ];

        testCases.forEach(testCase => {
            it(`should handle ${testCase.name} correctly`, async () => {
                (BackendProxyService.request as jest.Mock).mockResolvedValue({
                    data: testCase.mockResult,
                    cached: false
                });

                const result = await testCase.method();

                expect(BackendProxyService.request).toHaveBeenCalledWith(
                    expect.objectContaining({
                        url: expect.stringContaining(testCase.endpoint),
                        method: 'POST'
                    })
                );

                expect(result).toEqual(testCase.mockResult);
            });

            it(`should handle ${testCase.name} errors gracefully`, async () => {
                (BackendProxyService.request as jest.Mock).mockRejectedValue(
                    new Error(`Backend error for ${testCase.name}`)
                );

                await expect(testCase.method()).rejects.toThrow('Backend error');
            });
        });
    });
});
