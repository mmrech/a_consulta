/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gemini AI Type Definitions
 *
 * Type definitions for Gemini AI client integration.
 * Used by DirectGeminiClient for type-safe AI operations.
 */

import { Type } from "@google/genai";

// ==================== MODEL CONFIGURATION ====================

/**
 * Available Gemini models
 */
export const GEMINI_MODELS = {
  FLASH: 'gemini-2.5-flash',
  PRO: 'gemini-2.5-pro',
  FLASH_LATEST: 'gemini-flash-latest'
} as const;

export type GeminiModel = typeof GEMINI_MODELS[keyof typeof GEMINI_MODELS];

// ==================== GENERATION CONFIG ====================

/**
 * Configuration for AI content generation
 */
export interface GenerationConfig {
  /** Temperature controls randomness (0.0-1.0) */
  temperature?: number;
  /** Top-p sampling (0.0-1.0) */
  topP?: number;
  /** Top-k sampling */
  topK?: number;
  /** Maximum output tokens */
  maxOutputTokens?: number;
  /** Response MIME type (e.g., "application/json") */
  responseMimeType?: string;
  /** JSON schema for structured responses */
  responseSchema?: any;
  /** System instruction for the model */
  systemInstruction?: string;
  /** Tools to enable (e.g., Google Search) */
  tools?: Array<{ googleSearch?: object }>;
  /** Thinking configuration for deep analysis */
  thinkingConfig?: {
    thinkingBudget?: number;
  };
}

// ==================== REQUEST/RESPONSE TYPES ====================

/**
 * AI model response
 */
export interface ModelResponse {
  /** Generated text content */
  text: string;
  /** Full response object (optional) */
  raw?: any;
}

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
 * Metadata extraction result
 */
export interface MetadataResult {
  doi: string;
  pmid: string;
  journal: string;
  year: string;
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
 * Table extraction result
 */
export interface TableData {
  title: string;
  description?: string;
  data: string[][];
}

export interface TablesResult {
  tables: TableData[];
}

// ==================== ERROR TYPES ====================

/**
 * Gemini API error types
 */
export enum GeminiErrorType {
  /** API key missing or invalid */
  AUTHENTICATION = 'authentication',
  /** Rate limit exceeded (429) */
  RATE_LIMIT = 'rate_limit',
  /** Quota exceeded */
  QUOTA_EXCEEDED = 'quota_exceeded',
  /** Network timeout */
  TIMEOUT = 'timeout',
  /** Server error (5xx) */
  SERVER_ERROR = 'server_error',
  /** Invalid request */
  INVALID_REQUEST = 'invalid_request',
  /** Unknown error */
  UNKNOWN = 'unknown'
}

/**
 * Categorized AI error
 */
export interface CategorizedError {
  type: GeminiErrorType;
  originalError: any;
  userMessage: string;
  technicalMessage: string;
  isRetryable: boolean;
  retryAfterMs?: number;
}

// ==================== CLIENT CONFIGURATION ====================

/**
 * DirectGeminiClient configuration
 */
export interface DirectGeminiClientConfig {
  /** Gemini API key */
  apiKey: string;
  /** Default timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Retry delay in milliseconds (default: 2000) */
  retryDelay?: number;
  /** Enable circuit breaker (default: true) */
  useCircuitBreaker?: boolean;
}

// ==================== RETRY CONFIGURATION ====================

/**
 * Retry configuration for exponential backoff
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Delay in milliseconds for each retry attempt */
  delays: number[];
  /** HTTP status codes that should trigger a retry */
  retryableStatusCodes: number[];
}

// ==================== JSON SCHEMAS ====================

/**
 * Helper to create JSON schemas for structured output
 */
export const createSchema = {
  /**
   * PICO-T extraction schema
   */
  pico: {
    type: Type.OBJECT,
    properties: {
      "population": {
        "type": Type.STRING,
        "description": "The study population (e.g., '57 patients with malignant cerebellar infarction')"
      },
      "intervention": {
        "type": Type.STRING,
        "description": "The intervention performed (e.g., 'suboccipital decompressive craniectomy (SDC)')"
      },
      "comparator": {
        "type": Type.STRING,
        "description": "The comparison group (e.g., 'best medical treatment alone' or 'no comparator')"
      },
      "outcomes": {
        "type": Type.STRING,
        "description": "The primary outcomes measured (e.g., 'mRS at 12-month follow-up')"
      },
      "timing": {
        "type": Type.STRING,
        "description": "The follow-up timing (e.g., '12-month follow-up')"
      },
      "studyType": {
        "type": Type.STRING,
        "description": "The type of study (e.g., 'retrospective-matched case-control study')"
      }
    }
  },

  /**
   * Field validation schema
   */
  validation: {
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

  /**
   * Metadata extraction schema
   */
  metadata: {
    type: Type.OBJECT,
    properties: {
      "doi": { "type": Type.STRING, "description": "The DOI of the paper" },
      "pmid": { "type": Type.STRING, "description": "The PubMed ID (PMID) of the paper" },
      "journal": { "type": Type.STRING, "description": "The name of the journal" },
      "year": { "type": Type.STRING, "description": "The 4-digit publication year" }
    }
  },

  /**
   * Table extraction schema
   */
  tables: {
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
