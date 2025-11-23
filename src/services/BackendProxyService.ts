/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BackendProxyService - API proxy and request management
 * 
 * Provides centralized API request handling with:
 * - Request/response interceptors
 * - Automatic retry with exponential backoff
 * - Request caching
 * - Rate limiting
 * - Error handling and logging
 * - CORS proxy support
 * - Request queuing
 */

export interface ProxyConfig {
    baseURL?: string;
    timeout?: number;
    retryAttempts?: number;
    retryDelay?: number;
    cacheEnabled?: boolean;
    cacheTTL?: number;
    rateLimitPerSecond?: number;
}

export interface ProxyRequest {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    headers?: Record<string, string>;
    body?: any;
    params?: Record<string, string>;
    timeout?: number;
    cache?: boolean;
}

export interface ProxyResponse<T = any> {
    data: T;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    cached: boolean;
    requestTime: number;
}

interface CacheEntry {
    data: any;
    timestamp: number;
    ttl: number;
}

interface QueuedRequest<T = any> {
    request: ProxyRequest;
    resolve: (value: ProxyResponse<T>) => void;
    reject: (error: Error) => void;
    timestamp: number;
}

/**
 * Simple cache with FIFO eviction for responses
 */
class ResponseCache {
    private cache = new Map<string, CacheEntry>();
    private maxSize = 100;

    set(key: string, data: any, ttl: number): void {
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl,
        });
    }

    get(key: string): any | null {
        const entry = this.cache.get(key);
        if (!entry) return null;

        if (Date.now() - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }
}

/**
 * Rate limiter using token bucket algorithm
 */
class RateLimiter {
    private tokens: number;
    private lastRefill: number;
    private tokensPerSecond: number;

    constructor(tokensPerSecond: number) {
        this.tokensPerSecond = tokensPerSecond;
        this.tokens = tokensPerSecond;
        this.lastRefill = Date.now();
    }

    async acquire(): Promise<void> {
        this.refill();

        if (this.tokens >= 1) {
            this.tokens -= 1;
            return;
        }

        const waitTime = (1 - this.tokens) / this.tokensPerSecond * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        this.refill();
        this.tokens = Math.max(0, this.tokens - 1);
    }

    private refill(): void {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        this.tokens = Math.min(
            this.tokensPerSecond,
            this.tokens + elapsed * this.tokensPerSecond
        );
        this.lastRefill = now;
    }
}

export const BackendProxyService = {
    config: {
        baseURL: '',
        timeout: 30000,
        retryAttempts: 3,
        retryDelay: 1000,
        cacheEnabled: true,
        cacheTTL: 300000, // 5 minutes
        rateLimitPerSecond: 10,
    } as ProxyConfig,

    cache: new ResponseCache(),
    rateLimiter: null as RateLimiter | null,
    requestQueue: [] as QueuedRequest[],
    isProcessingQueue: false,

    /**
     * Configure the proxy service
     */
    configure: (config: Partial<ProxyConfig>): void => {
        BackendProxyService.config = {
            ...BackendProxyService.config,
            ...config,
        };

        if (config.rateLimitPerSecond) {
            BackendProxyService.rateLimiter = new RateLimiter(config.rateLimitPerSecond);
        }
    },

    /**
     * Generate cache key from request
     */
    getCacheKey: (request: ProxyRequest): string => {
        const { url, method, params, body } = request;
        const paramsStr = params ? JSON.stringify(params) : '';
        const bodyStr = body ? JSON.stringify(body) : '';
        return `${method}:${url}:${paramsStr}:${bodyStr}`;
    },

    /**
     * Build full URL with params
     */
    buildURL: (url: string, params?: Record<string, string>): string => {
        const baseURL = BackendProxyService.config.baseURL || '';
        const fullURL = url.startsWith('http') ? url : `${baseURL}${url}`;

        if (!params || Object.keys(params).length === 0) {
            return fullURL;
        }

        const urlObj = new URL(fullURL);
        Object.entries(params).forEach(([key, value]) => {
            urlObj.searchParams.append(key, value);
        });

        return urlObj.toString();
    },

    /**
     * Execute HTTP request with retry logic
     */
    executeRequest: async <T = any>(
        request: ProxyRequest,
        attempt = 1
    ): Promise<ProxyResponse<T>> => {
        const startTime = Date.now();
        const url = BackendProxyService.buildURL(request.url, request.params);
        const timeout = request.timeout || BackendProxyService.config.timeout || 30000;

        try {
            if (BackendProxyService.rateLimiter) {
                await BackendProxyService.rateLimiter.acquire();
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(url, {
                method: request.method,
                headers: {
                    'Content-Type': 'application/json',
                    ...request.headers,
                },
                body: request.body ? JSON.stringify(request.body) : undefined,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
<<<<<<< Current (Your changes)
                // Try to get error message from response body
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                try {
                    const contentType = response.headers.get('content-type');
                    if (contentType?.includes('application/json')) {
                        const errorData = await response.json();
                        errorMessage = errorData.message || errorData.error || errorMessage;
                    } else if (typeof response.text === 'function') {
                        const errorText = await response.text();
                        if (errorText) errorMessage = errorText;
                    }
                } catch (e) {
                    // Ignore errors reading response body
                }
=======
                // Always include HTTP status in error message for consistency
                // Format: "HTTP {status}: {message}"
                // Note: We don't read response body here to avoid consuming it
                // The statusText is sufficient for error reporting
                const errorMessage = `HTTP ${response.status}: ${response.statusText}`;
>>>>>>> Incoming (Background Agent changes)
                throw new Error(errorMessage);
            }

            const contentType = response.headers.get('content-type');
            let data: any;

            if (contentType?.includes('application/json')) {
                data = await response.json();
            } else if (typeof response.text === 'function') {
                data = await response.text();
            } else {
                data = '';
            }

            const requestTime = Date.now() - startTime;

            return {
                data,
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                cached: false,
                requestTime,
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            if (attempt < (BackendProxyService.config.retryAttempts || 3)) {
                const delay = (BackendProxyService.config.retryDelay || 1000) * Math.pow(2, attempt - 1);
                console.warn(`⚠️ Request failed (attempt ${attempt}), retrying in ${delay}ms...`);
                
                await new Promise(resolve => setTimeout(resolve, delay));
                return BackendProxyService.executeRequest<T>(request, attempt + 1);
            }

            console.error(`❌ Request failed after ${attempt} attempts:`, errorMessage);
            throw new Error(`Request failed: ${errorMessage}`);
        }
    },

    /**
     * Make a proxied request
     */
    request: async <T = any>(request: ProxyRequest): Promise<ProxyResponse<T>> => {
        if (
            request.cache !== false &&
            BackendProxyService.config.cacheEnabled &&
            request.method === 'GET'
        ) {
            const cacheKey = BackendProxyService.getCacheKey(request);
            const cached = BackendProxyService.cache.get(cacheKey);

            if (cached) {
                return {
                    ...cached,
                    cached: true,
                    requestTime: 0,
                };
            }
        }

        const response = await BackendProxyService.executeRequest<T>(request);

        if (
            request.cache !== false &&
            BackendProxyService.config.cacheEnabled &&
            request.method === 'GET' &&
            response.status >= 200 &&
            response.status < 300
        ) {
            const cacheKey = BackendProxyService.getCacheKey(request);
            const ttl = BackendProxyService.config.cacheTTL || 300000;
            BackendProxyService.cache.set(cacheKey, response, ttl);
        }

        return response;
    },

    /**
     * Convenience methods for common HTTP verbs
     */
    get: async <T = any>(
        url: string,
        params?: Record<string, string>,
        headers?: Record<string, string>
    ): Promise<ProxyResponse<T>> => {
        return BackendProxyService.request<T>({
            url,
            method: 'GET',
            params,
            headers,
        });
    },

    post: async <T = any>(
        url: string,
        body?: any,
        headers?: Record<string, string>
    ): Promise<ProxyResponse<T>> => {
        return BackendProxyService.request<T>({
            url,
            method: 'POST',
            body,
            headers,
        });
    },

    put: async <T = any>(
        url: string,
        body?: any,
        headers?: Record<string, string>
    ): Promise<ProxyResponse<T>> => {
        return BackendProxyService.request<T>({
            url,
            method: 'PUT',
            body,
            headers,
        });
    },

    delete: async <T = any>(
        url: string,
        headers?: Record<string, string>
    ): Promise<ProxyResponse<T>> => {
        return BackendProxyService.request<T>({
            url,
            method: 'DELETE',
            headers,
        });
    },

    patch: async <T = any>(
        url: string,
        body?: any,
        headers?: Record<string, string>
    ): Promise<ProxyResponse<T>> => {
        return BackendProxyService.request<T>({
            url,
            method: 'PATCH',
            body,
            headers,
        });
    },

    /**
     * Queue a request for later execution
     */
    queueRequest: <T = any>(request: ProxyRequest): Promise<ProxyResponse<T>> => {
        return new Promise((resolve, reject) => {
            BackendProxyService.requestQueue.push({
                request,
                resolve: resolve as (value: ProxyResponse) => void,
                reject,
                timestamp: Date.now(),
            });

            if (!BackendProxyService.isProcessingQueue) {
                BackendProxyService.processQueue();
            }
        });
    },

    /**
     * Process queued requests
     */
    processQueue: async (): Promise<void> => {
        if (BackendProxyService.isProcessingQueue) return;
        BackendProxyService.isProcessingQueue = true;

        while (BackendProxyService.requestQueue.length > 0) {
            const queued = BackendProxyService.requestQueue.shift();
            if (!queued) break;

            try {
                const response = await BackendProxyService.request(queued.request);
                queued.resolve(response);
            } catch (error) {
                queued.reject(error as Error);
            }
        }

        BackendProxyService.isProcessingQueue = false;
    },

    /**
     * Clear cache
     */
    clearCache: (): void => {
        BackendProxyService.cache.clear();
    },

    /**
     * Get cache statistics
     */
    getCacheStats: (): { size: number; maxSize: number } => {
        return {
            size: BackendProxyService.cache.size(),
            maxSize: 100,
        };
    },

    /**
     * Get queue statistics
     */
    getQueueStats: (): { pending: number; processing: boolean } => {
        return {
            pending: BackendProxyService.requestQueue.length,
            processing: BackendProxyService.isProcessingQueue,
        };
    },

    /**
     * Create a CORS proxy URL.
     * @param targetURL The target URL to proxy.
     * @param proxyURL The CORS proxy URL. Must be explicitly provided; no default is set.
     * @throws Error if proxyURL is not provided.
     */
    createCORSProxyURL: (targetURL: string, proxyURL: string): string => {
        if (!proxyURL) {
            throw new Error('CORS proxy URL must be explicitly provided. No default is set.');
        }
        return `${proxyURL}${encodeURIComponent(targetURL)}`;
    },

    /**
     * Batch multiple requests
     */
    batch: async <T = any>(requests: ProxyRequest[]): Promise<ProxyResponse<T>[]> => {
        const promises = requests.map(request => 
            BackendProxyService.request<T>(request).catch(error => ({
                data: null,
                status: 0,
                statusText: error.message,
                headers: {},
                cached: false,
                requestTime: 0,
            } as ProxyResponse<T>))
        );

        return Promise.all(promises);
    },

    /**
     * Health check endpoint
     */
    healthCheck: async (url?: string): Promise<boolean> => {
        const checkURL = url || `${BackendProxyService.config.baseURL}/health`;
        
        try {
            const response = await BackendProxyService.get(checkURL);
            return response.status >= 200 && response.status < 300;
        } catch (error) {
            return false;
        }
    },
};

export default BackendProxyService;
