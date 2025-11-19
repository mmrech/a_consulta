/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DirectGeminiClient Tests
 *
 * Tests for the DirectGeminiClient service that provides direct Gemini API access.
 */

import { DirectGeminiClient } from '../../src/services/DirectGeminiClient';
import type { PICOResult, ValidationResult, MetadataResult, TableResult } from '../../src/services/DirectGeminiClient';

// Mock the Google GenAI SDK
jest.mock('@google/genai', () => ({
    GoogleGenAI: jest.fn().mockImplementation(() => ({
        models: {
            generateContent: jest.fn().mockResolvedValue({
                text: JSON.stringify({
                    population: 'Test population',
                    intervention: 'Test intervention',
                    comparator: 'Test comparator',
                    outcomes: 'Test outcomes',
                    timing: 'Test timing',
                    studyType: 'Test study type'
                })
            })
        }
    })),
    Type: {
        OBJECT: 'object',
        STRING: 'string',
        BOOLEAN: 'boolean',
        NUMBER: 'number',
        ARRAY: 'array'
    }
}));

// Mock environment variables
const mockEnv = {
    VITE_GEMINI_API_KEY: 'test-api-key'
};

Object.defineProperty(import.meta, 'env', {
    value: mockEnv,
    writable: true
});

describe('DirectGeminiClient', () => {
    let client: DirectGeminiClient;

    beforeEach(() => {
        client = new DirectGeminiClient();
        jest.clearAllMocks();
    });

    describe('Configuration', () => {
        it('should check if API key is configured', () => {
            expect(client.isConfigured()).toBe(true);
        });

        it('should report unconfigured when API key is missing', () => {
            const originalEnv = import.meta.env.VITE_GEMINI_API_KEY;
            delete (import.meta.env as any).VITE_GEMINI_API_KEY;

            const newClient = new DirectGeminiClient();
            expect(newClient.isConfigured()).toBe(false);

            // Restore
            (import.meta.env as any).VITE_GEMINI_API_KEY = originalEnv;
        });
    });

    describe('Circuit Breaker', () => {
        it('should have CLOSED circuit breaker initially', () => {
            expect(client.getCircuitBreakerStatus()).toBe('CLOSED');
        });

        it('should reset circuit breaker', () => {
            client.resetCircuitBreaker();
            expect(client.getCircuitBreakerStatus()).toBe('CLOSED');
        });
    });

    describe('PICO Extraction', () => {
        it('should generate PICO-T summary successfully', async () => {
            const result = await client.generatePICO('Sample PDF text');

            expect(result).toHaveProperty('population');
            expect(result).toHaveProperty('intervention');
            expect(result).toHaveProperty('comparator');
            expect(result).toHaveProperty('outcomes');
            expect(result).toHaveProperty('timing');
            expect(result).toHaveProperty('studyType');
        });

        it('should return empty strings for missing fields', async () => {
            const mockGenerateContent = jest.fn().mockResolvedValue({
                text: JSON.stringify({})
            });

            (client as any).ai = {
                models: {
                    generateContent: mockGenerateContent
                }
            };

            const result = await client.generatePICO('Sample PDF text');

            expect(result.population).toBe('');
            expect(result.intervention).toBe('');
            expect(result.comparator).toBe('');
        });
    });

    describe('Summary Generation', () => {
        it('should generate summary successfully', async () => {
            const mockGenerateContent = jest.fn().mockResolvedValue({
                text: 'This is a summary of the clinical study.'
            });

            (client as any).ai = {
                models: {
                    generateContent: mockGenerateContent
                }
            };

            const result = await client.generateSummary('Sample PDF text');

            expect(result).toBe('This is a summary of the clinical study.');
            expect(mockGenerateContent).toHaveBeenCalled();
        });
    });

    describe('Field Validation', () => {
        it('should validate field successfully', async () => {
            const mockGenerateContent = jest.fn().mockResolvedValue({
                text: JSON.stringify({
                    is_supported: true,
                    supporting_quote: 'Direct quote from document',
                    confidence_score: 0.95
                })
            });

            (client as any).ai = {
                models: {
                    generateContent: mockGenerateContent
                }
            };

            const result = await client.validateField('test-field', 'Test claim', 'Sample PDF text');

            expect(result.is_supported).toBe(true);
            expect(result.supporting_quote).toBe('Direct quote from document');
            expect(result.confidence_score).toBe(0.95);
        });

        it('should handle unsupported claims', async () => {
            const mockGenerateContent = jest.fn().mockResolvedValue({
                text: JSON.stringify({
                    is_supported: false,
                    supporting_quote: 'No evidence found',
                    confidence_score: 0.85
                })
            });

            (client as any).ai = {
                models: {
                    generateContent: mockGenerateContent
                }
            };

            const result = await client.validateField('test-field', 'Unsupported claim', 'Sample PDF text');

            expect(result.is_supported).toBe(false);
        });
    });

    describe('Metadata Search', () => {
        it('should find metadata successfully', async () => {
            const mockGenerateContent = jest.fn().mockResolvedValue({
                text: JSON.stringify({
                    doi: '10.1234/test',
                    pmid: '12345678',
                    journal: 'Test Journal',
                    year: '2023'
                })
            });

            (client as any).ai = {
                models: {
                    generateContent: mockGenerateContent
                }
            };

            const result = await client.findMetadata('Test citation');

            expect(result.doi).toBe('10.1234/test');
            expect(result.pmid).toBe('12345678');
            expect(result.journal).toBe('Test Journal');
            expect(result.year).toBe('2023');
        });

        it('should return empty strings for missing metadata', async () => {
            const mockGenerateContent = jest.fn().mockResolvedValue({
                text: JSON.stringify({})
            });

            (client as any).ai = {
                models: {
                    generateContent: mockGenerateContent
                }
            };

            const result = await client.findMetadata('Unknown citation');

            expect(result.doi).toBe('');
            expect(result.pmid).toBe('');
            expect(result.journal).toBe('');
            expect(result.year).toBe('');
        });
    });

    describe('Table Extraction', () => {
        it('should extract tables successfully', async () => {
            const mockGenerateContent = jest.fn().mockResolvedValue({
                text: JSON.stringify({
                    tables: [
                        {
                            title: 'Table 1: Patient Demographics',
                            description: 'Baseline characteristics',
                            data: [
                                ['Characteristic', 'Value'],
                                ['Age', '65 years'],
                                ['Sex', '60% male']
                            ]
                        }
                    ]
                })
            });

            (client as any).ai = {
                models: {
                    generateContent: mockGenerateContent
                }
            };

            const result = await client.extractTables('Sample PDF text');

            expect(result.tables).toHaveLength(1);
            expect(result.tables[0].title).toBe('Table 1: Patient Demographics');
            expect(result.tables[0].data).toHaveLength(3);
        });

        it('should return empty array when no tables found', async () => {
            const mockGenerateContent = jest.fn().mockResolvedValue({
                text: JSON.stringify({ tables: [] })
            });

            (client as any).ai = {
                models: {
                    generateContent: mockGenerateContent
                }
            };

            const result = await client.extractTables('Sample PDF text');

            expect(result.tables).toHaveLength(0);
        });
    });

    describe('Image Analysis', () => {
        it('should analyze image successfully', async () => {
            const mockGenerateContent = jest.fn().mockResolvedValue({
                text: 'This image shows a brain CT scan with visible hemorrhage.'
            });

            (client as any).ai = {
                models: {
                    generateContent: mockGenerateContent
                }
            };

            const result = await client.analyzeImage('base64-image-data', 'image/png', 'Describe this image');

            expect(result).toBe('This image shows a brain CT scan with visible hemorrhage.');
            expect(mockGenerateContent).toHaveBeenCalled();
        });
    });

    describe('Deep Analysis', () => {
        it('should perform deep analysis successfully', async () => {
            const mockGenerateContent = jest.fn().mockResolvedValue({
                text: 'Deep analysis result with complex reasoning about the clinical study.'
            });

            (client as any).ai = {
                models: {
                    generateContent: mockGenerateContent
                }
            };

            const result = await client.deepAnalysis('Sample PDF text', 'What are the key findings?');

            expect(result).toBe('Deep analysis result with complex reasoning about the clinical study.');
            expect(mockGenerateContent).toHaveBeenCalled();
        });
    });

    describe('Error Handling', () => {
        it('should throw error when API key is not configured', async () => {
            const originalEnv = import.meta.env.VITE_GEMINI_API_KEY;
            delete (import.meta.env as any).VITE_GEMINI_API_KEY;

            const newClient = new DirectGeminiClient();

            await expect(newClient.generatePICO('Sample text')).rejects.toThrow();

            // Restore
            (import.meta.env as any).VITE_GEMINI_API_KEY = originalEnv;
        });

        it('should handle invalid JSON responses', async () => {
            const mockGenerateContent = jest.fn().mockResolvedValue({
                text: 'Invalid JSON {['
            });

            (client as any).ai = {
                models: {
                    generateContent: mockGenerateContent
                }
            };

            await expect(client.generatePICO('Sample text')).rejects.toThrow(/invalid response format/i);
        });

        it('should handle empty responses', async () => {
            const mockGenerateContent = jest.fn().mockResolvedValue({
                text: ''
            });

            (client as any).ai = {
                models: {
                    generateContent: mockGenerateContent
                }
            };

            await expect(client.generatePICO('Sample text')).rejects.toThrow(/empty response/i);
        });
    });

    describe('Retry Logic', () => {
        it('should retry on retryable errors', async () => {
            let callCount = 0;
            const mockGenerateContent = jest.fn().mockImplementation(() => {
                callCount++;
                if (callCount < 2) {
                    const error = new Error('Rate limit exceeded');
                    (error as any).status = 429;
                    throw error;
                }
                return Promise.resolve({
                    text: JSON.stringify({ population: 'Test' })
                });
            });

            (client as any).ai = {
                models: {
                    generateContent: mockGenerateContent
                }
            };

            // Increase timeout for retry test
            jest.setTimeout(10000);

            const result = await client.generatePICO('Sample text');

            expect(mockGenerateContent).toHaveBeenCalledTimes(2);
            expect(result.population).toBe('Test');
        });

        it('should not retry on non-retryable errors', async () => {
            const mockGenerateContent = jest.fn().mockRejectedValue(
                new Error('Invalid API key')
            );

            (client as any).ai = {
                models: {
                    generateContent: mockGenerateContent
                }
            };

            await expect(client.generatePICO('Sample text')).rejects.toThrow();
            expect(mockGenerateContent).toHaveBeenCalledTimes(1);
        });
    });

    describe('Integration Tests', () => {
        it('should handle complete PICO extraction workflow', async () => {
            const mockGenerateContent = jest.fn().mockResolvedValue({
                text: JSON.stringify({
                    population: '150 patients with cerebellar stroke',
                    intervention: 'Decompressive craniectomy',
                    comparator: 'Medical management',
                    outcomes: 'mRS at 6 months',
                    timing: '6-month follow-up',
                    studyType: 'Retrospective cohort study'
                })
            });

            (client as any).ai = {
                models: {
                    generateContent: mockGenerateContent
                }
            };

            const pdfText = 'Sample clinical study about cerebellar stroke treatment...';
            const result = await client.generatePICO(pdfText);

            expect(result).toMatchObject({
                population: '150 patients with cerebellar stroke',
                intervention: 'Decompressive craniectomy',
                comparator: 'Medical management',
                outcomes: 'mRS at 6 months',
                timing: '6-month follow-up',
                studyType: 'Retrospective cohort study'
            });
        });
    });
});
