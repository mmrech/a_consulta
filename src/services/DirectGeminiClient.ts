/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DirectGeminiClient
 * Direct Gemini API client for clinical data extraction
 *
 * This service provides a clean abstraction over the Google Gemini API,
 * handling model selection, schema definitions, and error handling.
 * It serves as a fallback when the backend is unavailable.
 *
 * ⚠️ SECURITY WARNING:
 * This implementation uses frontend-exposed API keys. For production deployments:
 * - Use backend proxy architecture (see BACKEND_MIGRATION_PLAN.md)
 * - Implement rate limiting and request authentication
 * - Monitor API usage for abuse
 * - Consider using Firebase App Check or similar attestation
 *
 * @see BACKEND_MIGRATION_PLAN.md for migration to backend architecture
 */

import { GoogleGenAI, Type } from "@google/genai";
import CircuitBreaker from '../utils/CircuitBreaker';
import { categorizeAIError, isErrorRetryable, logErrorWithContext } from '../utils/aiErrorHandler';

// ==================== TYPES ====================

/**
 * PICO-T extraction result
 */
export interface PICOResult {
  population: string;
  intervention: string;
  comparator: string;
  outcomes: string;
  timing: string;
  studyType: string;
}

/**
 * Field validation result
 */
export interface ValidationResult {
  is_supported: boolean;
  supporting_quote: string;
  confidence_score: number;
}

/**
 * Metadata search result
 */
export interface MetadataResult {
  doi: string;
  pmid: string;
  journal: string;
  year: string;
}

/**
 * Extracted table data
 */
export interface TableData {
  title: string;
  description?: string;
  data: string[][];
}

/**
 * Table extraction result
 */
export interface TableResult {
  tables: TableData[];
}

// ==================== CONFIGURATION ====================

/**
 * Retry configuration for API calls
 */
const RETRY_CONFIG = {
  maxAttempts: 3,
  delays: [2000, 4000, 8000], // 2s, 4s, 8s
  retryableStatusCodes: [429, 500, 502, 503, 504]
};

// ==================== GEMINI MODEL SELECTION ====================

/**
 * Model selection for different AI tasks
 *
 * Model Distribution:
 * - gemini-2.5-flash (Fast): PICO, metadata with Google Search, image analysis
 * - gemini-flash-latest (Fast): Summary generation
 * - gemini-2.5-pro (Powerful): Field validation, table extraction, deep analysis (with thinking)
 */
const MODELS = {
  FAST: 'gemini-2.5-flash',
  LATEST: 'gemini-flash-latest',
  PRO: 'gemini-2.5-pro',
} as const;

// ==================== RETRY HELPER FUNCTIONS ====================

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

      if (!isErrorRetryable(error)) {
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

      await delay(delayMs);
    }
  }

  throw lastError;
}

// ==================== DIRECT GEMINI CLIENT ====================

/**
 * DirectGeminiClient
 *
 * Provides direct access to Google Gemini API for clinical data extraction.
 * Handles model selection, schema definitions, retry logic, and error handling.
 *
 * Usage:
 * ```typescript
 * const client = new DirectGeminiClient(apiKey);
 * const picoResult = await client.generatePICO(pdfText);
 * ```
 */
export class DirectGeminiClient {
  private ai: GoogleGenAI;
  private circuitBreaker: CircuitBreaker;

  /**
   * Creates a new DirectGeminiClient instance
   * @param apiKey - Google Gemini API key
   * @throws Error if API key is not provided
   */
  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }

    this.ai = new GoogleGenAI({ apiKey });
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 60000,
    });
  }

  /**
   * Generates PICO-T summary from PDF text
   * Model: gemini-2.5-flash (fast, structured extraction)
   *
   * @param pdfText - Full text of the PDF document
   * @returns PICO-T structured data (population, intervention, comparator, outcomes, timing, studyType)
   *
   * @example
   * ```typescript
   * const result = await client.generatePICO(documentText);
   * console.log(result.population); // "57 patients with malignant cerebellar infarction"
   * ```
   */
  async generatePICO(pdfText: string): Promise<PICOResult> {
    const systemPrompt = "You are an expert clinical research assistant specializing in systematic reviews. Your task is to extract PICO-TT (Population, Intervention, Comparator, Outcomes, Timing, and sTudy Type) information from the provided clinical study text using the PICO-TT framework methodology. This framework is essential for systematic review quality and research reproducibility. Return the information as a JSON object. Be concise and accurate. If information is not found, return an empty string for that field.";
    const userPrompt = `Here is the clinical study text:\n\n${pdfText}`;

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

    try {
      const response = await this.circuitBreaker.execute(async () => {
        return await retryWithExponentialBackoff(async () => {
          return await this.ai.models.generateContent({
            model: MODELS.FAST,
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
      return safeJsonParse(jsonText, 'PICO-T extraction');

    } catch (error: any) {
      logErrorWithContext(error, 'PICO-T extraction');
      const categorized = categorizeAIError(error, 'PICO-T extraction');
      throw new Error(categorized.userMessage);
    }
  }

  /**
   * Generates summary of key findings from PDF text
   * Model: gemini-flash-latest (fast, natural language generation)
   *
   * @param pdfText - Full text of the PDF document
   * @returns 2-3 paragraph summary of key findings
   *
   * @example
   * ```typescript
   * const summary = await client.generateSummary(documentText);
   * console.log(summary); // "This study enrolled 57 patients..."
   * ```
   */
  async generateSummary(pdfText: string): Promise<string> {
    const systemPrompt = "You are an expert clinical research assistant. Your task is to read the provided clinical study text and write a concise summary (2-3 paragraphs) focusing on the key findings, outcomes, and any identified predictors of those outcomes.";
    const userPrompt = `Please summarize the following clinical study text:\n\n${pdfText}`;

    try {
      const response = await this.circuitBreaker.execute(async () => {
        return await retryWithExponentialBackoff(async () => {
          return await this.ai.models.generateContent({
            model: MODELS.LATEST,
            contents: [{ parts: [{ text: userPrompt }] }],
            config: {
              systemInstruction: systemPrompt,
            }
          });
        }, 'Summary generation');
      });

      return response.text;

    } catch (error: any) {
      logErrorWithContext(error, 'Summary generation');
      const categorized = categorizeAIError(error, 'Summary generation');
      throw new Error(categorized.userMessage);
    }
  }

  /**
   * Validates a field's content against the PDF text
   * Model: gemini-2.5-pro (powerful, fact-checking)
   *
   * @param fieldId - ID of the field being validated
   * @param value - Current value of the field
   * @param pdfText - Full text of the PDF document
   * @returns Validation result with support status, quote, and confidence score
   *
   * @example
   * ```typescript
   * const validation = await client.validateField('field-1', 'claim text', documentText);
   * console.log(validation.is_supported); // true/false
   * console.log(validation.confidence_score); // 0.0-1.0
   * ```
   */
  async validateField(fieldId: string, value: string, pdfText: string): Promise<ValidationResult> {
    const systemPrompt = `You are a fact-checking expert specializing in clinical research papers. Your task is to determine if a given "claim" is directly supported by the provided "document text". You must respond with a JSON object.`;
    const userPrompt = `DOCUMENT TEXT:\n"""${pdfText}"""\n\nCLAIM:\n"""${value}"""\n\nBased on the document text, is the claim supported? Provide a direct quote if it is.`;

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

    try {
      const response = await this.circuitBreaker.execute(async () => {
        return await retryWithExponentialBackoff(async () => {
          return await this.ai.models.generateContent({
            model: MODELS.PRO,
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
      return safeJsonParse(jsonText, 'Field validation');

    } catch (error: any) {
      logErrorWithContext(error, 'Field validation');
      const categorized = categorizeAIError(error, 'Field validation');
      throw new Error(categorized.userMessage);
    }
  }

  /**
   * Finds study metadata using Google Search grounding
   * Model: gemini-2.5-flash + Google Search (fast, search-enhanced)
   *
   * @param citationText - Citation text or title to search for
   * @returns Metadata (DOI, PMID, journal, year)
   *
   * @example
   * ```typescript
   * const metadata = await client.findMetadata("Kim et al 2016 cerebellar infarction");
   * console.log(metadata.doi); // "10.xxxx/xxxxx"
   * ```
   */
  async findMetadata(citationText: string): Promise<MetadataResult> {
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

    try {
      const response = await retryWithExponentialBackoff(async () => {
        return await this.ai.models.generateContent({
          model: MODELS.FAST,
          contents: [{ parts: [{ text: userPrompt }] }],
          config: {
            systemInstruction: systemPrompt,
            tools: [{googleSearch: {}}],
            responseMimeType: "application/json",
            responseSchema: metadataSchema
          }
        });
      }, 'Metadata search');

      return safeJsonParse(response.text, 'Metadata search');

    } catch (error: any) {
      logErrorWithContext(error, 'Metadata search');
      const categorized = categorizeAIError(error, 'Metadata search');
      throw new Error(categorized.userMessage);
    }
  }

  /**
   * Extracts tables from document text
   * Model: gemini-2.5-pro (powerful, structured extraction)
   *
   * @param pdfText - Full text of the PDF document
   * @returns Array of extracted tables with title, description, and data
   *
   * @example
   * ```typescript
   * const result = await client.extractTables(documentText);
   * console.log(result.tables.length); // Number of tables found
   * console.log(result.tables[0].title); // "Table 1: Patient Demographics"
   * ```
   */
  async extractTables(pdfText: string): Promise<TableResult> {
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

    try {
      const response = await this.circuitBreaker.execute(async () => {
        return await retryWithExponentialBackoff(async () => {
          return await this.ai.models.generateContent({
            model: MODELS.PRO,
            contents: pdfText,
            config: {
              systemInstruction: systemPrompt,
              responseMimeType: "application/json",
              responseSchema: tableSchema
            }
          });
        }, 'Table extraction');
      });

      const jsonText = response.text;
      return safeJsonParse(jsonText, 'Table extraction');

    } catch (error: any) {
      logErrorWithContext(error, 'Table extraction');
      const categorized = categorizeAIError(error, 'Table extraction');
      throw new Error(categorized.userMessage);
    }
  }

  /**
   * Analyzes an image with a text prompt
   * Model: gemini-2.5-flash (fast, multimodal)
   *
   * @param imageBase64 - Base64-encoded image data
   * @param mimeType - MIME type of the image (e.g., 'image/png')
   * @param prompt - Analysis prompt
   * @returns AI analysis of the image
   *
   * @example
   * ```typescript
   * const analysis = await client.analyzeImage(base64Data, 'image/png', 'Describe this figure');
   * console.log(analysis); // "This figure shows..."
   * ```
   */
  async analyzeImage(imageBase64: string, mimeType: string, prompt: string): Promise<string> {
    const imagePart = {
      inlineData: {
        mimeType: mimeType,
        data: imageBase64,
      },
    };
    const textPart = {
      text: prompt
    };

    try {
      const response = await this.circuitBreaker.execute(async () => {
        return await retryWithExponentialBackoff(async () => {
          return await this.ai.models.generateContent({
            model: MODELS.FAST,
            contents: { parts: [imagePart, textPart] },
          });
        }, 'Image analysis');
      });

      return response.text;

    } catch (error: any) {
      logErrorWithContext(error, 'Image analysis');
      const categorized = categorizeAIError(error, 'Image analysis');
      throw new Error(categorized.userMessage);
    }
  }

  /**
   * Performs deep analysis on document text with extended thinking
   * Model: gemini-2.5-pro (powerful, with 32768 thinking budget)
   *
   * @param pdfText - Full text of the PDF document
   * @param prompt - Analysis question or task
   * @returns AI analysis result
   *
   * @example
   * ```typescript
   * const analysis = await client.deepAnalysis(documentText, 'What are the key limitations?');
   * console.log(analysis); // "The main limitations include..."
   * ```
   */
  async deepAnalysis(pdfText: string, prompt: string): Promise<string> {
    const fullPrompt = `Based on the following document text, please answer this question: ${prompt}\n\nDOCUMENT TEXT:\n${pdfText}`;

    try {
      const response = await this.circuitBreaker.execute(async () => {
        return await retryWithExponentialBackoff(async () => {
          return await this.ai.models.generateContent({
            model: MODELS.PRO,
            contents: fullPrompt,
            config: {
              thinkingConfig: { thinkingBudget: 32768 }
            }
          });
        }, 'Deep analysis');
      });

      return response.text;

    } catch (error: any) {
      logErrorWithContext(error, 'Deep analysis');
      const categorized = categorizeAIError(error, 'Deep analysis');
      throw new Error(categorized.userMessage);
    }
  }

  /**
   * Get the underlying GoogleGenAI instance for advanced usage
   * @returns GoogleGenAI instance
   */
  getAI(): GoogleGenAI {
    return this.ai;
  }
}

/**
 * Factory function to create a DirectGeminiClient instance with API key from environment
 *
 * @returns DirectGeminiClient instance or null if API key is not configured
 * @throws Error with user-friendly message if API key is missing
 */
export function createDirectGeminiClient(): DirectGeminiClient | null {
  const API_KEY = import.meta.env.VITE_GEMINI_API_KEY ||
                  import.meta.env.VITE_API_KEY ||
                  import.meta.env.VITE_GOOGLE_API_KEY;

  if (!API_KEY) {
    const errorMsg = `⚠️ Gemini API Key Not Configured

To use AI features, create a .env.local file in the project root with:
VITE_GEMINI_API_KEY=your_api_key_here

Get your free API key at: https://ai.google.dev/`;

    throw new Error(errorMsg);
  }

  return new DirectGeminiClient(API_KEY);
}

export default DirectGeminiClient;
