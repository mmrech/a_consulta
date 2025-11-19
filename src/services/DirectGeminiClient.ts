/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DirectGeminiClient
 *
 * A clean, reusable client for direct Gemini API interactions.
 * Used as a fallback when the backend is unavailable (frontend-only mode).
 *
 * Features:
 * - 7 core AI functions matching backend API
 * - 3 model configurations (gemini-2.5-flash, gemini-2.5-pro, gemini-flash-latest)
 * - Retry logic with exponential backoff
 * - Circuit breaker for fault tolerance
 * - Comprehensive error handling
 * - JSON schema validation
 *
 * Models:
 * - gemini-2.5-flash: PICO extraction, metadata search (with Google Search), image analysis
 * - gemini-flash-latest: Summary generation
 * - gemini-2.5-pro: Field validation, table extraction, deep analysis (32768 thinking budget)
 *
 * ⚠️ SECURITY WARNING:
 * This client loads the Gemini API key from environment variables, exposing it
 * in the frontend JavaScript bundle. Only use this for:
 * - Development and testing
 * - Personal projects and demos
 * - Fallback when backend is unavailable
 *
 * For production, use the backend proxy architecture (BackendProxyService).
 */

import { GoogleGenAI, Type } from "@google/genai";
import CircuitBreaker from '../utils/CircuitBreaker';
import { categorizeAIError, isErrorRetryable, formatErrorMessage, logErrorWithContext } from '../utils/aiErrorHandler';

// ==================== TYPES & INTERFACES ====================

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
    doi: string;
    pmid: string;
    journal: string;
    year: string;
}

export interface TableData {
    title: string;
    description?: string;
    data: string[][];
}

export interface TableResult {
    tables: TableData[];
}

export interface AIError {
    category: string;
    userMessage: string;
    technicalMessage: string;
    isRetryable: boolean;
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

/**
 * Model configurations
 */
const MODELS = {
    FLASH: 'gemini-2.5-flash',
    FLASH_LATEST: 'gemini-flash-latest',
    PRO: 'gemini-2.5-pro'
};

/**
 * Generation configurations for different tasks
 */
const GENERATION_CONFIGS = {
    PICO: {
        temperature: 0.2,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 2048,
    },
    SUMMARY: {
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 1024,
    },
    VALIDATION: {
        temperature: 0.1,
        topP: 0.8,
        topK: 20,
        maxOutputTokens: 512,
    },
    METADATA: {
        temperature: 0.1,
        topP: 0.8,
        topK: 20,
        maxOutputTokens: 256,
    },
    TABLES: {
        temperature: 0.2,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 4096,
    },
    IMAGE: {
        temperature: 0.5,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 1024,
    },
    DEEP: {
        temperature: 0.3,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 2048,
    }
};

// ==================== PROMPT TEMPLATES ====================

const PROMPTS = {
    PICO: {
        system: "You are an expert clinical research assistant specializing in systematic reviews. Your task is to extract PICO-TT (Population, Intervention, Comparator, Outcomes, Timing, and sTudy Type) information from the provided clinical study text using the PICO-TT framework methodology. This framework is essential for systematic review quality and research reproducibility. Return the information as a JSON object. Be concise and accurate. If information is not found, return an empty string for that field.",
        user: (documentText: string) => `Here is the clinical study text:\n\n${documentText}`
    },
    SUMMARY: {
        system: "You are an expert clinical research assistant. Your task is to read the provided clinical study text and write a concise summary (2-3 paragraphs) focusing on the key findings, outcomes, and any identified predictors of those outcomes.",
        user: (documentText: string) => `Please summarize the following clinical study text:\n\n${documentText}`
    },
    VALIDATION: {
        system: "You are a fact-checking expert specializing in clinical research papers. Your task is to determine if a given \"claim\" is directly supported by the provided \"document text\". You must respond with a JSON object.",
        user: (documentText: string, claim: string) =>
            `DOCUMENT TEXT:\n"""${documentText}"""\n\nCLAIM:\n"""${claim}"""\n\nBased on the document text, is the claim supported? Provide a direct quote if it is.`
    },
    METADATA: {
        system: "You are a research assistant. Find the metadata for the given study. Use Google Search to find the information. If a value isn't found, return an empty string for it. Provide only the JSON response.",
        user: (citationText: string) =>
            `Find the DOI, PMID, journal name, and publication year for the following study: "${citationText}"`
    },
    TABLES: {
        system: "You are a data extraction specialist. Analyze the provided text from a clinical research paper. Identify all tables and extract their content. Structure the output as a JSON object. The object should have a single key 'tables' which is an array. Each object in the array should represent one table and have 'title' (the table's caption or title), 'description' (a brief summary of the table's content), and 'data' (a 2D array of strings representing rows and columns, including headers). If no tables are found, return an empty array for the 'tables' key.",
        user: (documentText: string) => documentText
    },
    IMAGE: {
        system: "",
        user: (prompt: string) => prompt
    },
    DEEP: {
        system: "",
        user: (documentText: string, prompt: string) =>
            `Based on the following document text, please answer this question: ${prompt}\n\nDOCUMENT TEXT:\n${documentText}`
    }
};

// ==================== JSON SCHEMAS ====================

const SCHEMAS = {
    PICO: {
        type: Type.OBJECT,
        properties: {
            "population": { "type": Type.STRING, "description": "The study population (e.g., '57 patients with malignant cerebellar infarction')" },
            "intervention": { "type": Type.STRING, "description": "The intervention performed (e.g., 'suboccipital decompressive craniectomy (SDC)')" },
            "comparator": { "type": Type.STRING, "description": "The comparison group (e.g., 'best medical treatment alone' or 'no comparator')" },
            "outcomes": { "type": Type.STRING, "description": "The primary outcomes measured (e.g., 'mRS at 12-month follow-up')" },
            "timing": { "type": Type.STRING, "description": "The follow-up timing (e.g., '12-month follow-up')" },
            "studyType": { "type": Type.STRING, "description": "The type of study (e.g., 'retrospective-matched case-control study')" }
        }
    },
    VALIDATION: {
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
    },
    METADATA: {
        type: Type.OBJECT,
        properties: {
            "doi": { "type": Type.STRING, "description": "The DOI of the paper" },
            "pmid": { "type": Type.STRING, "description": "The PubMed ID (PMID) of the paper" },
            "journal": { "type": Type.STRING, "description": "The name of the journal" },
            "year": { "type": Type.STRING, "description": "The 4-digit publication year" }
        }
    },
    TABLES: {
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
    }
};

// ==================== DIRECTGEMINICLIENT CLASS ====================

/**
 * DirectGeminiClient - Clean abstraction for Gemini API interactions
 */
export class DirectGeminiClient {
    private ai: GoogleGenAI | null = null;
    private circuitBreaker: CircuitBreaker;

    constructor() {
        this.circuitBreaker = new CircuitBreaker({
            failureThreshold: 5,
            successThreshold: 2,
            timeout: 60000,
        });
    }

    // ==================== INITIALIZATION ====================

    /**
     * Initialize Google Generative AI client
     * @throws Error if API key is not configured
     */
    private initializeAI(): GoogleGenAI {
        if (this.ai) return this.ai;

        const API_KEY = import.meta.env.VITE_GEMINI_API_KEY ||
                        import.meta.env.VITE_API_KEY ||
                        import.meta.env.VITE_GOOGLE_API_KEY;

        if (!API_KEY) {
            throw new Error(
                '⚠️ Gemini API Key Not Configured\n\n' +
                'To use AI features, create a .env.local file in the project root with:\n' +
                'VITE_GEMINI_API_KEY=your_api_key_here\n\n' +
                'Get your free API key at: https://ai.google.dev/'
            );
        }

        this.ai = new GoogleGenAI({ apiKey: API_KEY });
        return this.ai;
    }

    // ==================== RETRY LOGIC ====================

    /**
     * Delays execution for a specified number of milliseconds
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Wraps an async function with exponential backoff retry logic
     */
    private async retryWithExponentialBackoff<T>(
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

                await this.delay(delayMs);
            }
        }

        throw lastError;
    }

    /**
     * Safely parses JSON with comprehensive error handling
     */
    private safeJsonParse(jsonText: string, context: string = 'AI response'): any {
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

    // ==================== CORE AI FUNCTIONS ====================

    /**
     * 1. Generate PICO-T summary
     * Model: gemini-2.5-flash
     */
    async generatePICO(pdfText: string): Promise<PICOResult> {
        try {
            const response = await this.circuitBreaker.execute(async () => {
                return await this.retryWithExponentialBackoff(async () => {
                    return await this.initializeAI().models.generateContent({
                        model: MODELS.FLASH,
                        contents: [{ parts: [{ text: PROMPTS.PICO.user(pdfText) }] }],
                        config: {
                            systemInstruction: PROMPTS.PICO.system,
                            responseMimeType: "application/json",
                            responseSchema: SCHEMAS.PICO,
                            ...GENERATION_CONFIGS.PICO
                        }
                    });
                }, 'PICO-T extraction');
            });

            const jsonText = response.text;
            const data = this.safeJsonParse(jsonText, 'PICO-T extraction');

            return {
                population: data.population || '',
                intervention: data.intervention || '',
                comparator: data.comparator || '',
                outcomes: data.outcomes || '',
                timing: data.timing || '',
                studyType: data.studyType || ''
            };
        } catch (error: any) {
            logErrorWithContext(error, 'DirectGeminiClient.generatePICO');
            const categorized = categorizeAIError(error, 'PICO-T extraction');
            throw new Error(formatErrorMessage(categorized));
        }
    }

    /**
     * 2. Generate summary of key findings
     * Model: gemini-flash-latest
     */
    async generateSummary(pdfText: string): Promise<string> {
        try {
            const response = await this.circuitBreaker.execute(async () => {
                return await this.retryWithExponentialBackoff(async () => {
                    return await this.initializeAI().models.generateContent({
                        model: MODELS.FLASH_LATEST,
                        contents: [{ parts: [{ text: PROMPTS.SUMMARY.user(pdfText) }] }],
                        config: {
                            systemInstruction: PROMPTS.SUMMARY.system,
                            ...GENERATION_CONFIGS.SUMMARY
                        }
                    });
                }, 'Summary generation');
            });

            return response.text;
        } catch (error: any) {
            logErrorWithContext(error, 'DirectGeminiClient.generateSummary');
            const categorized = categorizeAIError(error, 'Summary generation');
            throw new Error(formatErrorMessage(categorized));
        }
    }

    /**
     * 3. Validate field content against PDF text
     * Model: gemini-2.5-pro
     */
    async validateField(fieldId: string, value: string, pdfText: string): Promise<ValidationResult> {
        try {
            const response = await this.circuitBreaker.execute(async () => {
                return await this.retryWithExponentialBackoff(async () => {
                    return await this.initializeAI().models.generateContent({
                        model: MODELS.PRO,
                        contents: [{ parts: [{ text: PROMPTS.VALIDATION.user(pdfText, value) }] }],
                        config: {
                            systemInstruction: PROMPTS.VALIDATION.system,
                            responseMimeType: "application/json",
                            responseSchema: SCHEMAS.VALIDATION,
                            ...GENERATION_CONFIGS.VALIDATION
                        }
                    });
                }, 'Field validation');
            });

            const jsonText = response.text;
            const validation = this.safeJsonParse(jsonText, 'Field validation');

            return {
                is_supported: validation.is_supported || false,
                supporting_quote: validation.supporting_quote || '',
                confidence_score: validation.confidence_score || 0
            };
        } catch (error: any) {
            logErrorWithContext(error, 'DirectGeminiClient.validateField');
            const categorized = categorizeAIError(error, 'Field validation');
            throw new Error(formatErrorMessage(categorized));
        }
    }

    /**
     * 4. Find metadata using Google Search grounding
     * Model: gemini-2.5-flash + Google Search
     */
    async findMetadata(citationText: string): Promise<MetadataResult> {
        try {
            const response = await this.retryWithExponentialBackoff(async () => {
                return await this.initializeAI().models.generateContent({
                    model: MODELS.FLASH,
                    contents: [{ parts: [{ text: PROMPTS.METADATA.user(citationText) }] }],
                    config: {
                        systemInstruction: PROMPTS.METADATA.system,
                        tools: [{googleSearch: {}}],
                        responseMimeType: "application/json",
                        responseSchema: SCHEMAS.METADATA,
                        ...GENERATION_CONFIGS.METADATA
                    }
                });
            }, 'Metadata search');

            const jsonText = response.text;
            const data = this.safeJsonParse(jsonText, 'Metadata search');

            return {
                doi: data.doi || '',
                pmid: data.pmid || '',
                journal: data.journal || '',
                year: data.year || ''
            };
        } catch (error: any) {
            logErrorWithContext(error, 'DirectGeminiClient.findMetadata');
            const categorized = categorizeAIError(error, 'Metadata search');
            throw new Error(formatErrorMessage(categorized));
        }
    }

    /**
     * 5. Extract tables from document
     * Model: gemini-2.5-pro
     */
    async extractTables(pdfText: string): Promise<TableResult> {
        try {
            const response = await this.circuitBreaker.execute(async () => {
                return await this.retryWithExponentialBackoff(async () => {
                    return await this.initializeAI().models.generateContent({
                        model: MODELS.PRO,
                        contents: PROMPTS.TABLES.user(pdfText),
                        config: {
                            systemInstruction: PROMPTS.TABLES.system,
                            responseMimeType: "application/json",
                            responseSchema: SCHEMAS.TABLES,
                            ...GENERATION_CONFIGS.TABLES
                        }
                    });
                }, 'Table extraction');
            });

            const jsonText = response.text;
            const result = this.safeJsonParse(jsonText, 'Table extraction');

            return {
                tables: result.tables || []
            };
        } catch (error: any) {
            logErrorWithContext(error, 'DirectGeminiClient.extractTables');
            const categorized = categorizeAIError(error, 'Table extraction');
            throw new Error(formatErrorMessage(categorized));
        }
    }

    /**
     * 6. Analyze uploaded image with prompt
     * Model: gemini-2.5-flash
     */
    async analyzeImage(imageBase64: string, mimeType: string, prompt: string): Promise<string> {
        try {
            const imagePart = {
                inlineData: {
                    mimeType: mimeType,
                    data: imageBase64,
                },
            };
            const textPart = {
                text: PROMPTS.IMAGE.user(prompt)
            };

            const response = await this.circuitBreaker.execute(async () => {
                return await this.retryWithExponentialBackoff(async () => {
                    return await this.initializeAI().models.generateContent({
                        model: MODELS.FLASH,
                        contents: { parts: [imagePart, textPart] },
                        config: GENERATION_CONFIGS.IMAGE
                    });
                }, 'Image analysis');
            });

            return response.text;
        } catch (error: any) {
            logErrorWithContext(error, 'DirectGeminiClient.analyzeImage');
            const categorized = categorizeAIError(error, 'Image analysis');
            throw new Error(formatErrorMessage(categorized));
        }
    }

    /**
     * 7. Deep analysis with thinking budget
     * Model: gemini-2.5-pro (32768 thinking budget)
     */
    async deepAnalysis(pdfText: string, analysisPrompt: string): Promise<string> {
        try {
            const response = await this.circuitBreaker.execute(async () => {
                return await this.retryWithExponentialBackoff(async () => {
                    return await this.initializeAI().models.generateContent({
                        model: MODELS.PRO,
                        contents: PROMPTS.DEEP.user(pdfText, analysisPrompt),
                        config: {
                            thinkingConfig: { thinkingBudget: 32768 },
                            ...GENERATION_CONFIGS.DEEP
                        }
                    });
                }, 'Deep analysis');
            });

            return response.text;
        } catch (error: any) {
            logErrorWithContext(error, 'DirectGeminiClient.deepAnalysis');
            const categorized = categorizeAIError(error, 'Deep analysis');
            throw new Error(formatErrorMessage(categorized));
        }
    }

    // ==================== UTILITY METHODS ====================

    /**
     * Check if API key is configured
     */
    isConfigured(): boolean {
        const API_KEY = import.meta.env.VITE_GEMINI_API_KEY ||
                        import.meta.env.VITE_API_KEY ||
                        import.meta.env.VITE_GOOGLE_API_KEY;
        return !!API_KEY;
    }

    /**
     * Get circuit breaker status
     */
    getCircuitBreakerStatus(): string {
        return this.circuitBreaker.getState();
    }

    /**
     * Reset circuit breaker (useful for testing)
     */
    resetCircuitBreaker(): void {
        this.circuitBreaker.reset();
    }
}

// ==================== SINGLETON EXPORT ====================

/**
 * Singleton instance of DirectGeminiClient
 * Use this for all direct Gemini API interactions
 */
const directGeminiClient = new DirectGeminiClient();

export default directGeminiClient;
