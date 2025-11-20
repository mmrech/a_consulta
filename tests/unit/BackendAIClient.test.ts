import BackendAIClient from '../../src/services/BackendAIClient';

describe('BackendAIClient', () => {
  const originalFetch = global.fetch as jest.Mock;
  const backendUrl = 'http://localhost:8000';

  beforeEach(() => {
    jest.clearAllMocks();
    originalFetch.mockReset();
  });

  it('calls the backend PICO endpoint with pdf text', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        population: 'pop',
        intervention: 'int',
        comparator: 'comp',
        outcomes: 'out',
        timing: 'time',
        study_type: 'type',
      }),
    } as any;

    originalFetch.mockResolvedValue(mockResponse);

    const result = await BackendAIClient.generatePICO('pdf text', 'doc-1');

    expect(result.population).toBe('pop');
    expect(originalFetch).toHaveBeenCalledWith(
      `${backendUrl}/api/ai/generate-pico`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ document_id: 'doc-1', pdf_text: 'pdf text' }),
      }),
    );
  });

  it('includes auth header when token is present', async () => {
    localStorage.setItem('la_consulta_access_token', 'token-123');

    originalFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ summary: 'hello' }),
    } as any);

    await BackendAIClient.generateSummary('pdf text');

    expect(originalFetch).toHaveBeenCalledWith(
      `${backendUrl}/api/ai/generate-summary`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      }),
    );
  });

  it('throws a helpful error message when backend responds with detail', async () => {
    originalFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ detail: 'backend error' }),
    } as any);

    await expect(BackendAIClient.validateField('field', 'value', 'pdf text')).rejects.toThrow(
      'backend error',
    );
  });

  it('returns false when health check fails', async () => {
    originalFetch.mockRejectedValueOnce(new Error('network'));

    const healthy = await BackendAIClient.healthCheck();

    expect(healthy).toBe(false);
  });
});
