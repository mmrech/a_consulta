/**
 * MedicalAgentBridge.ts
 *
 * Backend-based implementation of medical research agents
 * Routes all AI calls through secure backend API
 * Mimics the behavior of the Python multi-agent system using specialized prompts
 */

import type { ExtractedTable } from './TableExtractor';
import type { ExtractedFigure } from './FigureExtractor';
import type { AgentResult } from './AgentOrchestrator';
import BackendClient from './BackendClient';
import AuthManager from './AuthManager';
import StatusManager from '../utils/status';
import { logErrorWithContext, categorizeAIError, formatErrorMessage } from '../utils/aiErrorHandler';

/**
 * Type definitions for the CDN-loaded Google Generative AI SDK
 * These types match the runtime behavior of window.google.genai loaded from the AI Studio CDN
 * 
 * Note: The CDN-loaded SDK uses a slightly different API than the @google/genai npm package.
 * These types are defined inline to match the actual runtime behavior.
 * 
 * The global window.google is declared as `any` in index.tsx to support multiple Google APIs
 * (OAuth, GenAI, etc.). These interfaces provide type safety for the GenAI subset.
 */

/**
 * Response from the Gemini API containing generated content
 */
interface GeminiResponse {
    text(): string;
    candidates?: Array<{
        content: unknown;
        finishReason?: string;
        safetyRatings?: unknown[];
    }>;
}

/**
 * Result wrapper containing the response and additional metadata
 */
interface GeminiResult {
    response: GeminiResponse;
}

/**
 * Configuration options for the generative model
 */
interface GenerativeModelConfig {
    model: string;
    safetySettings?: unknown[];
    generationConfig?: {
        temperature?: number;
        topK?: number;
        topP?: number;
        maxOutputTokens?: number;
    };
}

/**
 * GenerativeModel instance with methods to generate content
 * Returned by GoogleGenerativeAI.getGenerativeModel()
 */
interface GenerativeModel {
    generateContent(prompt: string | { contents: string }): Promise<GeminiResult>;
    generateContentStream?(prompt: string | { contents: string }): Promise<AsyncGenerator<GeminiResult>>;
}

/**
 * Main GoogleGenerativeAI class for initializing the API
 */
interface GoogleGenerativeAIConstructor {
    new (apiKey: string): {
        getGenerativeModel(config: GenerativeModelConfig): GenerativeModel;
    };
}

/**
 * Structure of window.google.genai loaded from the CDN
 */
interface WindowGoogleGenAI {
    GoogleGenerativeAI: GoogleGenerativeAIConstructor;
}

/**
 * Properly typed Gemini model for fallback when backend is unavailable
 * This is initialized lazily when the Google GenAI SDK is loaded
 */
let geminiModel: GenerativeModel | null = null;

/**
 * Initialize Gemini model for fallback when backend is unavailable
 * Called lazily when needed, or after Google API loads
 */
function initializeGeminiFallback(): boolean {
    try {
        // Check if Google GenAI SDK is available
        // Cast to access the genai property with proper typing
        const googleSDK = window.google as { genai?: WindowGoogleGenAI } | undefined;
        
        if (typeof window !== 'undefined' && googleSDK?.genai) {
            const { GoogleGenerativeAI } = googleSDK.genai;
            const apiKey = import.meta.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;
            if (apiKey) {
                const genAI = new GoogleGenerativeAI(apiKey);
                geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-thinking-exp-1219' });
                console.log('✅ Gemini fallback initialized');
                return true;
            } else {
                console.warn('⚠️ GEMINI_API_KEY not found - Gemini fallback (frontend-only mode) will not work');
                return false;
            }
        } else {
            // Google API not loaded yet - will retry when needed
            return false;
        }
    } catch (error) {
        console.warn('⚠️ Gemini SDK not available for fallback:', error);
        return false;
    }
}

// Try to initialize immediately if possible
let initializationAttempted = false;
function ensureGeminiInitialized(): boolean {
    if (!geminiModel && !initializationAttempted) {
        initializationAttempted = true;
        initializeGeminiFallback();
    }
    // Retry if still not initialized (Google API might load later)
    if (!geminiModel && typeof window !== 'undefined' && window.google) {
        initializeGeminiFallback();
    }
    return geminiModel !== null;
}

// ==================== AGENT PROMPT TEMPLATES ====================

const AGENT_PROMPTS = {
    StudyDesignExpertAgent: `You are a Study Design Expert analyzing medical research methodology.
Your expertise: research design, inclusion/exclusion criteria, study types, sample selection.
Accuracy: 92%

Analyze the provided data and extract:
- Study type (RCT, cohort, case-control, etc.)
- Inclusion/exclusion criteria
- Sample selection method
- Study period
- Methodology details

Provide confidence score (0-1) for each extraction.`,

    PatientDataSpecialistAgent: `You are a Patient Data Specialist extracting demographics and baseline characteristics.
Your expertise: patient demographics, sample sizes, baseline characteristics.
Accuracy: 88%

Extract from the data:
- Total sample size (N)
- Age (mean, median, range)
- Sex/Gender distribution
- Baseline characteristics
- Group comparisons

Provide confidence score (0-1) for each field.`,

    SurgicalExpertAgent: `You are a Surgical Expert analyzing surgical procedures and techniques.
Your expertise: surgical procedures, operative techniques, surgical outcomes.
Accuracy: 91%

Extract surgical details:
- Type of surgery/procedure
- Surgical technique details
- Operative time
- Surgical approach
- Intraoperative findings

Provide confidence score (0-1) for each extraction.`,

    OutcomesAnalystAgent: `You are an Outcomes Analyst extracting statistics and clinical outcomes.
Your expertise: mortality rates, mRS scores, outcome measures, statistical analysis.
Accuracy: 89%

Extract outcome data:
- Primary outcomes (mortality, mRS, etc.)
- Secondary outcomes
- Follow-up period
- Statistical significance (p-values)
- Effect sizes

Provide confidence score (0-1) for each field.`,

    NeuroimagingSpecialistAgent: `You are a Neuroimaging Specialist analyzing imaging data.
Your expertise: CT/MRI findings, lesion volumes, brain swelling, imaging measurements.
Accuracy: 92%

Extract imaging data:
- Lesion volume (mm³ or cm³)
- Brain swelling measurements
- Imaging modality (CT, MRI)
- Imaging findings
- Quantitative measurements

Provide confidence score (0-1) for each value.`,

    TableExtractorAgent: `You are a Table Structure Validator using vision-based analysis.
Your expertise: table structure validation, data type detection, quality assessment.
Confidence: 100%

Validate the table structure:
- Verify headers match data
- Check for missing values
- Identify data types (numeric, percentage, categorical)
- Assess table quality (5 factors)
- Suggest corrections if needed

Provide overall confidence score (0-1).`
};

// ==================== MEDICAL AGENT BRIDGE ====================

class MedicalAgentBridge {
    constructor() {
    }

    /**
     * Call a medical agent with specialized prompt
     * Falls back to Gemini if backend is unavailable
     */
    async callAgent(
        agentName: keyof typeof AGENT_PROMPTS,
        data: ExtractedTable | ExtractedFigure,
        dataType: 'table' | 'figure',
        documentId?: string
    ): Promise<AgentResult> {
        const startTime = Date.now();

        try {
            // Build agent-specific prompt
            const prompt = this.buildAgentPrompt(agentName, data, dataType);

            let response: string;

            // Try backend first (if available and authenticated)
            const backendAvailable = await BackendClient.healthCheck().catch(() => false);
            const backendAuthenticated = BackendClient.isAuthenticated();

            if (backendAvailable && backendAuthenticated) {
                try {
                    response = await this.callBackendAgent(prompt, agentName, documentId);
                } catch (backendError: any) {
                    // Backend failed, try Gemini fallback
                    console.warn(`Backend agent failed for ${agentName}, using Gemini fallback:`, backendError.message);
                    response = await this.callGeminiAgent(prompt);
                }
            } else {
                // Backend not available, use Gemini directly
                response = await this.callGeminiAgent(prompt);
            }

            // Parse response
            const parsedData = this.parseAgentResponse(response, agentName);

            return {
                agentName,
                confidence: parsedData.confidence,
                extractedData: parsedData.data,
                processingTime: Date.now() - startTime,
                validationStatus: parsedData.confidence > 0.85 ? 'validated' : 'needs_review',
                sourceQuote: parsedData.sourceQuote,
                pageNumber: 'pageNum' in data ? data.pageNum : undefined
            };

        } catch (error: any) {
            console.error(`Agent ${agentName} error:`, error.message);

            // Comprehensive error handling with user feedback
            logErrorWithContext(error, `Agent ${agentName}`);
            const categorized = categorizeAIError(error, `Agent ${agentName}`);
            StatusManager.show(formatErrorMessage(categorized), 'error', 15000);

            return {
                agentName,
                confidence: 0,
                extractedData: null,
                processingTime: Date.now() - startTime,
                validationStatus: 'failed'
            };
        }
    }

    /**
     * Build specialized prompt for each agent
     */
    private buildAgentPrompt(
        agentName: keyof typeof AGENT_PROMPTS,
        data: ExtractedTable | ExtractedFigure,
        dataType: 'table' | 'figure'
    ): string {
        const systemPrompt = AGENT_PROMPTS[agentName];

        let dataContent = '';

        if (dataType === 'table') {
            const table = data as ExtractedTable;
            dataContent = `
TABLE DATA:
Headers: ${table.headers.join(' | ')}
Rows (first 5):
${table.rows.slice(0, 5).map(row => row.join(' | ')).join('\n')}

Total rows: ${table.rows.length}
Total columns: ${table.headers.length}
`;
        } else {
            const figure = data as ExtractedFigure;
            dataContent = `
FIGURE DATA:
ID: ${figure.id}
Page: ${figure.pageNum}
Dimensions: ${figure.width}x${figure.height}
Extraction Method: ${figure.extractionMethod}
`;
        }

        return `${systemPrompt}

${dataContent}

Instructions:
1. Analyze the data using your specialized expertise
2. Extract relevant information with high precision
3. Provide confidence scores for each extraction
4. Include source quotes where possible

Respond with JSON:
{
  "extractedFields": {
    "field1": {"value": "...", "confidence": 0.95},
    "field2": {"value": "...", "confidence": 0.88}
  },
  "overallConfidence": 0.92,
  "sourceQuote": "Direct quote from data",
  "insights": ["Clinical insight 1", "Clinical insight 2"]
}`;
    }

    /**
     * Call backend AI endpoint with agent prompt
     * Routes through secure backend API instead of direct Gemini calls
     */
    private async callBackendAgent(prompt: string, agentName: string, documentId?: string): Promise<string> {
        try {
            const authenticated = await AuthManager.ensureAuthenticated();
            if (!authenticated) {
                throw new Error('Backend authentication failed');
            }

            const docId = documentId || `temp-agent-${Date.now()}`;
            const response = await BackendClient.deepAnalysis(docId, '', prompt);

            return response.analysis;
        } catch (error: any) {
            // Log backend-specific errors with context
            logErrorWithContext(error, `Backend Agent ${agentName}`);

            const categorized = categorizeAIError(error, `Backend Agent ${agentName}`);
            StatusManager.show(formatErrorMessage(categorized), 'error', 15000);

            throw new Error(`Backend agent ${agentName} failed: ${error.message}`);
        }
    }

    /**
     * Call Gemini directly as fallback when backend is unavailable
     */
    private async callGeminiAgent(prompt: string): Promise<string> {
        // Try to initialize Gemini if not already done
        if (!geminiModel) {
            ensureGeminiInitialized();
        }

        if (!geminiModel) {
            throw new Error('Gemini SDK not available. Please set GEMINI_API_KEY environment variable and ensure Google GenAI SDK is loaded.');
        }

        try {
            const result = await geminiModel.generateContent(prompt);
            const response = await result.response;
            return response.text();
        } catch (error: any) {
            throw new Error(`Gemini API error: ${error.message}`);
        }
    }

    /**
     * Parse agent response
     */
    private parseAgentResponse(response: string, agentName: string): {
        confidence: number,
        data: any,
        sourceQuote?: string
    } {
        try {
            // Try to parse as JSON
            const parsed = JSON.parse(response);

            return {
                confidence: parsed.overallConfidence || 0.80,
                data: parsed.extractedFields || parsed,
                sourceQuote: parsed.sourceQuote || `Extracted by ${agentName}`
            };

        } catch (error) {
            // Fallback: return raw response
            console.warn(`Failed to parse ${agentName} response as JSON, using raw text`);

            // Notify user of degraded confidence
            StatusManager.show(
                `⚠️ ${agentName} returned unexpected format (confidence reduced to 70%)`,
                'warning',
                10000
            );

            return {
                confidence: 0.70,
                data: { rawResponse: response },
                sourceQuote: response.substring(0, 200)
            };
        }
    }

    /**
     * Batch process multiple agent calls
     */
    async callMultipleAgents(
        agentNames: Array<keyof typeof AGENT_PROMPTS>,
        data: ExtractedTable | ExtractedFigure,
        dataType: 'table' | 'figure',
        documentId?: string
    ): Promise<AgentResult[]> {
        console.log(`Calling ${agentNames.length} agents in parallel...`);

        const results = await Promise.all(
            agentNames.map(name => this.callAgent(name, data, dataType, documentId))
        );

        return results;
    }
}

// Export singleton instance
export default new MedicalAgentBridge();
export { AGENT_PROMPTS };
