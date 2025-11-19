/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for DirectGeminiClient
 * Tests all 7 AI functions with mocked GoogleGenAI responses
 */

import { DirectGeminiClient } from '../../src/services/DirectGeminiClient';
import type { PICOResult, ValidationResult, MetadataResult, TableResult } from '../../src/services/DirectGeminiClient';

// Mock GoogleGenAI
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: jest.fn(),
    },
  })),
  Type: {
    OBJECT: 'object',
    STRING: 'string',
    BOOLEAN: 'boolean',
    NUMBER: 'number',
    ARRAY: 'array',
  },
}));

// Mock error handler
jest.mock('../../src/utils/aiErrorHandler', () => ({
  categorizeAIError: jest.fn((error: any, context: string) => ({
    category: 'UNKNOWN',
    severity: 'HIGH',
    isRetryable: false,
    userMessage: error.message || 'An error occurred',
    technicalDetails: error.toString(),
  })),
  isErrorRetryable: jest.fn(() => false),
  logErrorWithContext: jest.fn(),
}));

// Mock circuit breaker
jest.mock('../../src/utils/CircuitBreaker', () => ({
  default: jest.fn().mockImplementation(() => ({
    execute: jest.fn((fn) => fn()),
  })),
}));

describe('DirectGeminiClient', () => {
  let client: DirectGeminiClient;
  let mockGenerateContent: any;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create client
    client = new DirectGeminiClient('test-api-key');

    // Get reference to mocked generateContent
    mockGenerateContent = (client as any).ai.models.generateContent;
  });

  describe('Constructor', () => {
    it('should throw error if API key is not provided', () => {
      expect(() => new DirectGeminiClient('')).toThrow('Gemini API key is required');
    });

    it('should create client successfully with valid API key', () => {
      expect(client).toBeDefined();
      expect(client).toBeInstanceOf(DirectGeminiClient);
    });
  });

  describe('generatePICO', () => {
    it('should extract PICO-T data successfully', async () => {
      const mockPICOData: PICOResult = {
        population: '57 patients with malignant cerebellar infarction',
        intervention: 'suboccipital decompressive craniectomy (SDC)',
        comparator: 'best medical treatment alone',
        outcomes: 'mRS at 12-month follow-up',
        timing: '12-month follow-up',
        studyType: 'retrospective-matched case-control study',
      };

      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify(mockPICOData),
      });

      const result = await client.generatePICO('Sample PDF text');

      expect(result).toEqual(mockPICOData);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-2.5-flash',
          contents: expect.arrayContaining([
            expect.objectContaining({
              parts: expect.arrayContaining([
                expect.objectContaining({
                  text: expect.stringContaining('Sample PDF text'),
                }),
              ]),
            }),
          ]),
        })
      );
    });

    it('should throw error on invalid JSON response', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Invalid JSON',
      });

      await expect(client.generatePICO('Sample PDF text')).rejects.toThrow();
    });
  });

  describe('generateSummary', () => {
    it('should generate summary successfully', async () => {
      const mockSummary = 'This study enrolled 57 patients with malignant cerebellar infarction...';

      mockGenerateContent.mockResolvedValue({
        text: mockSummary,
      });

      const result = await client.generateSummary('Sample PDF text');

      expect(result).toBe(mockSummary);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-flash-latest',
        })
      );
    });

    it('should return text directly without parsing', async () => {
      const mockText = 'Summary text';
      mockGenerateContent.mockResolvedValue({ text: mockText });

      const result = await client.generateSummary('Sample PDF text');

      expect(result).toBe(mockText);
    });
  });

  describe('validateField', () => {
    it('should validate field successfully with support', async () => {
      const mockValidation: ValidationResult = {
        is_supported: true,
        supporting_quote: 'The study enrolled 57 patients...',
        confidence_score: 0.95,
      };

      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify(mockValidation),
      });

      const result = await client.validateField('field-1', 'claim text', 'Sample PDF text');

      expect(result).toEqual(mockValidation);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-2.5-pro',
        })
      );
    });

    it('should validate field with no support', async () => {
      const mockValidation: ValidationResult = {
        is_supported: false,
        supporting_quote: 'No evidence found in document',
        confidence_score: 0.85,
      };

      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify(mockValidation),
      });

      const result = await client.validateField('field-1', 'unsupported claim', 'Sample PDF text');

      expect(result.is_supported).toBe(false);
      expect(result.confidence_score).toBe(0.85);
    });
  });

  describe('findMetadata', () => {
    it('should find metadata successfully', async () => {
      const mockMetadata: MetadataResult = {
        doi: '10.1234/example.2016.001',
        pmid: '27123456',
        journal: 'Stroke',
        year: '2016',
      };

      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify(mockMetadata),
      });

      const result = await client.findMetadata('Kim et al 2016 cerebellar infarction');

      expect(result).toEqual(mockMetadata);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-2.5-flash',
          config: expect.objectContaining({
            tools: [{ googleSearch: {} }],
          }),
        })
      );
    });

    it('should handle missing metadata fields gracefully', async () => {
      const mockMetadata: MetadataResult = {
        doi: '10.1234/example.2016.001',
        pmid: '',
        journal: 'Stroke',
        year: '',
      };

      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify(mockMetadata),
      });

      const result = await client.findMetadata('Citation text');

      expect(result.doi).toBe('10.1234/example.2016.001');
      expect(result.pmid).toBe('');
    });
  });

  describe('extractTables', () => {
    it('should extract tables successfully', async () => {
      const mockTables: TableResult = {
        tables: [
          {
            title: 'Table 1: Patient Demographics',
            description: 'Baseline characteristics of the study population',
            data: [
              ['Characteristic', 'SDC Group', 'Control Group'],
              ['Age (years)', '65 ± 12', '67 ± 10'],
              ['Male sex (%)', '60%', '55%'],
            ],
          },
          {
            title: 'Table 2: Outcomes',
            description: 'Primary and secondary outcomes',
            data: [
              ['Outcome', 'SDC', 'Control', 'P-value'],
              ['Mortality', '15%', '35%', '<0.001'],
            ],
          },
        ],
      };

      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify(mockTables),
      });

      const result = await client.extractTables('Sample PDF text');

      expect(result.tables).toHaveLength(2);
      expect(result.tables[0].title).toBe('Table 1: Patient Demographics');
      expect(result.tables[0].data).toHaveLength(3);
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-2.5-pro',
        })
      );
    });

    it('should return empty tables array when none found', async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({ tables: [] }),
      });

      const result = await client.extractTables('Sample PDF text');

      expect(result.tables).toEqual([]);
    });
  });

  describe('analyzeImage', () => {
    it('should analyze image successfully', async () => {
      const mockAnalysis = 'This figure shows a CT scan of a patient with cerebellar infarction...';

      mockGenerateContent.mockResolvedValue({
        text: mockAnalysis,
      });

      const result = await client.analyzeImage('base64ImageData', 'image/png', 'Describe this figure');

      expect(result).toBe(mockAnalysis);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-2.5-flash',
          contents: expect.objectContaining({
            parts: expect.arrayContaining([
              expect.objectContaining({
                inlineData: expect.objectContaining({
                  mimeType: 'image/png',
                  data: 'base64ImageData',
                }),
              }),
              expect.objectContaining({
                text: 'Describe this figure',
              }),
            ]),
          }),
        })
      );
    });
  });

  describe('deepAnalysis', () => {
    it('should perform deep analysis successfully', async () => {
      const mockAnalysis = 'The main limitations of this study include...';

      mockGenerateContent.mockResolvedValue({
        text: mockAnalysis,
      });

      const result = await client.deepAnalysis('Sample PDF text', 'What are the key limitations?');

      expect(result).toBe(mockAnalysis);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-2.5-pro',
          config: expect.objectContaining({
            thinkingConfig: { thinkingBudget: 32768 },
          }),
        })
      );
    });
  });

  describe('getAI', () => {
    it('should return GoogleGenAI instance', () => {
      const ai = client.getAI();
      expect(ai).toBeDefined();
      expect(ai).toHaveProperty('models');
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API Error'));

      await expect(client.generatePICO('Sample PDF text')).rejects.toThrow();
    });

    it('should handle network errors', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Network error'));

      await expect(client.generateSummary('Sample PDF text')).rejects.toThrow();
    });
  });
});

describe('createDirectGeminiClient factory', () => {
  it('should create client with environment API key', async () => {
    // Save original env
    const originalEnv = process.env.VITE_GEMINI_API_KEY;

    // Mock environment variable
    process.env.VITE_GEMINI_API_KEY = 'test-env-key';

    const { createDirectGeminiClient } = await import('../../src/services/DirectGeminiClient');
    const client = createDirectGeminiClient();

    expect(client).toBeDefined();
    expect(client).toBeInstanceOf(DirectGeminiClient);

    // Restore original env
    if (originalEnv) {
      process.env.VITE_GEMINI_API_KEY = originalEnv;
    } else {
      delete process.env.VITE_GEMINI_API_KEY;
    }
  });

  it('should throw error when API key is missing', async () => {
    // Save original env vars
    const originalGeminiKey = process.env.VITE_GEMINI_API_KEY;
    const originalApiKey = process.env.VITE_API_KEY;
    const originalGoogleKey = process.env.VITE_GOOGLE_API_KEY;

    // Clear environment variables
    delete process.env.VITE_GEMINI_API_KEY;
    delete process.env.VITE_API_KEY;
    delete process.env.VITE_GOOGLE_API_KEY;

    const { createDirectGeminiClient } = await import('../../src/services/DirectGeminiClient');

    expect(() => createDirectGeminiClient()).toThrow('Gemini API Key Not Configured');

    // Restore original env vars
    if (originalGeminiKey) process.env.VITE_GEMINI_API_KEY = originalGeminiKey;
    if (originalApiKey) process.env.VITE_API_KEY = originalApiKey;
    if (originalGoogleKey) process.env.VITE_GOOGLE_API_KEY = originalGoogleKey;
  });
});
