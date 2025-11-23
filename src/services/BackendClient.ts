/**
 * BackendClient
 * HTTP client for communicating with the la_consulta backend API
 * Handles authentication, token management, and API requests
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_API_URL || 'http://localhost:8080';

interface AuthTokens {
  access_token: string;
  token_type: string;
}

class BackendClient {
  private accessToken: string | null = null;

  constructor() {
    this.loadTokenFromStorage();
  }

  private loadTokenFromStorage(): void {
    const token = localStorage.getItem('la_consulta_access_token');
    if (token) {
      this.accessToken = token;
    }
  }

  private saveTokenToStorage(token: string): void {
    localStorage.setItem('la_consulta_access_token', token);
    this.accessToken = token;
  }

  private clearTokenFromStorage(): void {
    localStorage.removeItem('la_consulta_access_token');
    this.accessToken = null;
  }

  async register(email: string, password: string): Promise<AuthTokens> {
    const response = await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      let errorDetail = 'Registration failed';
      try {
        const error = await response.json();
        errorDetail = error.detail || error.message || errorDetail;
      } catch {
        const text = await response.text().catch(() => '');
        errorDetail = text || errorDetail;
      }
      throw new Error(errorDetail);
    }

    const tokens: AuthTokens = await response.json();
    this.saveTokenToStorage(tokens.access_token);
    return tokens;
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      let errorDetail = 'Login failed';
      try {
        const error = await response.json();
        errorDetail = error.detail || error.message || errorDetail;
      } catch {
        const text = await response.text().catch(() => '');
        errorDetail = text || errorDetail;
      }
      const error = new Error(errorDetail);
      // Attach status code for better error handling
      (error as any).status = response.status;
      throw error;
    }

    const tokens: AuthTokens = await response.json();
    this.saveTokenToStorage(tokens.access_token);
    return tokens;
  }

  logout(): void {
    this.clearTokenFromStorage();
  }

  isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  private async authenticatedRequest(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Please login first.');
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.accessToken}`,
      ...options.headers,
    };

    const response = await fetch(`${BACKEND_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      this.clearTokenFromStorage();
      throw new Error('Session expired. Please login again.');
    }

    return response;
  }

  async generatePICO(documentId: string, pdfText: string): Promise<any> {
    const response = await this.authenticatedRequest('/api/ai/generate-pico', {
      method: 'POST',
      body: JSON.stringify({ document_id: documentId, pdf_text: pdfText }),
    });

    if (!response.ok) {
      let errorDetail = 'PICO generation failed';
      try {
        const error = await response.json();
        errorDetail = error.detail || error.message || errorDetail;
      } catch {
        const text = await response.text().catch(() => '');
        errorDetail = text || errorDetail;
      }
      throw new Error(errorDetail);
    }

    return await response.json();
  }

  async generateSummary(documentId: string, pdfText: string): Promise<any> {
    const response = await this.authenticatedRequest('/api/ai/generate-summary', {
      method: 'POST',
      body: JSON.stringify({ document_id: documentId, pdf_text: pdfText }),
    });

    if (!response.ok) {
      let errorDetail = 'Summary generation failed';
      try {
        const error = await response.json();
        errorDetail = error.detail || error.message || errorDetail;
      } catch {
        const text = await response.text().catch(() => '');
        errorDetail = text || errorDetail;
      }
      throw new Error(errorDetail);
    }

    return await response.json();
  }

  async validateField(documentId: string, fieldId: string, fieldValue: string, pdfText: string): Promise<any> {
    const response = await this.authenticatedRequest('/api/ai/validate-field', {
      method: 'POST',
      body: JSON.stringify({
        document_id: documentId,
        field_id: fieldId,
        field_value: fieldValue,
        pdf_text: pdfText,
      }),
    });

    if (!response.ok) {
      let errorDetail = 'Field validation failed';
      try {
        const error = await response.json();
        errorDetail = error.detail || error.message || errorDetail;
      } catch {
        const text = await response.text().catch(() => '');
        errorDetail = text || errorDetail;
      }
      throw new Error(errorDetail);
    }

    return await response.json();
  }

  async findMetadata(documentId: string, pdfText: string): Promise<any> {
    const response = await this.authenticatedRequest('/api/ai/find-metadata', {
      method: 'POST',
      body: JSON.stringify({ document_id: documentId, pdf_text: pdfText }),
    });

    if (!response.ok) {
      let errorDetail = 'Metadata search failed';
      try {
        const error = await response.json();
        errorDetail = error.detail || error.message || errorDetail;
      } catch {
        const text = await response.text().catch(() => '');
        errorDetail = text || errorDetail;
      }
      throw new Error(errorDetail);
    }

    return await response.json();
  }

  async extractTables(documentId: string, pdfText: string): Promise<any> {
    const response = await this.authenticatedRequest('/api/ai/extract-tables', {
      method: 'POST',
      body: JSON.stringify({ document_id: documentId, pdf_text: pdfText }),
    });

    if (!response.ok) {
      let errorDetail = 'Table extraction failed';
      try {
        const error = await response.json();
        errorDetail = error.detail || error.message || errorDetail;
      } catch {
        const text = await response.text().catch(() => '');
        errorDetail = text || errorDetail;
      }
      throw new Error(errorDetail);
    }

    return await response.json();
  }

  async analyzeImage(documentId: string, imageBase64: string, prompt: string): Promise<any> {
    const response = await this.authenticatedRequest('/api/ai/analyze-image', {
      method: 'POST',
      body: JSON.stringify({
        document_id: documentId,
        image_base64: imageBase64,
        prompt: prompt,
      }),
    });

    if (!response.ok) {
      let errorDetail = 'Image analysis failed';
      try {
        const error = await response.json();
        errorDetail = error.detail || error.message || errorDetail;
      } catch {
        const text = await response.text().catch(() => '');
        errorDetail = text || errorDetail;
      }
      throw new Error(errorDetail);
    }

    return await response.json();
  }

  async deepAnalysis(documentId: string, pdfText: string, prompt: string): Promise<any> {
    const response = await this.authenticatedRequest('/api/ai/deep-analysis', {
      method: 'POST',
      body: JSON.stringify({
        document_id: documentId,
        pdf_text: pdfText,
        prompt: prompt,
      }),
    });

    if (!response.ok) {
      let errorDetail = 'Deep analysis failed';
      try {
        const error = await response.json();
        errorDetail = error.detail || error.message || errorDetail;
      } catch {
        const text = await response.text().catch(() => '');
        errorDetail = text || errorDetail;
      }
      throw new Error(errorDetail);
    }

    return await response.json();
  }

  async uploadDocument(filename: string, pdfData: string, totalPages: number, metadata?: any): Promise<any> {
    const response = await this.authenticatedRequest('/api/documents', {
      method: 'POST',
      body: JSON.stringify({
        filename,
        pdf_data: pdfData,
        total_pages: totalPages,
        metadata,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Document upload failed');
    }

    return await response.json();
  }

  async getDocuments(): Promise<any[]> {
    const response = await this.authenticatedRequest('/api/documents', {
      method: 'GET',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to fetch documents');
    }

    return await response.json();
  }

  async getDocument(documentId: string): Promise<any> {
    const response = await this.authenticatedRequest(`/api/documents/${documentId}`, {
      method: 'GET',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to fetch document');
    }

    return await response.json();
  }

  async deleteDocument(documentId: string): Promise<void> {
    const response = await this.authenticatedRequest(`/api/documents/${documentId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to delete document');
    }
  }

  /**
   * Check if backend is available and healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${BACKEND_URL}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000), // 2 second timeout
      });
      return response.ok;
    } catch (error) {
      return false; // Backend not available
    }
  }
}

export default new BackendClient();
