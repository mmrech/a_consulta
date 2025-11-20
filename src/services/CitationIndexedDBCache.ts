/**
 * IndexedDB Cache for File Search Store IDs
 * Stores mappings between document IDs and Gemini File Search store IDs
 * to avoid re-uploading PDFs that have already been processed
 */

const DB_NAME = 'CitationCacheDB'
const DB_VERSION = 1
const STORE_NAME = 'fileSearchStores'

interface FileSearchCacheEntry {
    documentId: string
    fileSearchStoreId: string
    fileName: string
    uploadDate: number
    pdfHash?: string  // Optional hash for detecting file changes
}

export class CitationIndexedDBCache {
    private db: IDBDatabase | null = null
    private isInitialized = false

    /**
     * Initialize the IndexedDB connection
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION)

            request.onerror = () => {
                console.error('Failed to open IndexedDB:', request.error)
                reject(request.error)
            }

            request.onsuccess = () => {
                this.db = request.result
                this.isInitialized = true
                console.log('✓ Citation IndexedDB cache initialized')
                resolve()
            }

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result

                // Create object store if it doesn't exist
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'documentId' })
                    
                    // Create indexes for efficient querying
                    store.createIndex('fileName', 'fileName', { unique: false })
                    store.createIndex('uploadDate', 'uploadDate', { unique: false })
                    store.createIndex('pdfHash', 'pdfHash', { unique: false })
                    
                    console.log('✓ Citation IndexedDB store created')
                }
            }
        })
    }

    /**
     * Store a file search store ID mapping
     */
    async setFileSearchStore(
        documentId: string,
        fileSearchStoreId: string,
        fileName: string,
        pdfHash?: string
    ): Promise<void> {
        if (!this.db) {
            await this.initialize()
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
            const store = transaction.objectStore(STORE_NAME)

            const entry: FileSearchCacheEntry = {
                documentId,
                fileSearchStoreId,
                fileName,
                uploadDate: Date.now(),
                pdfHash
            }

            const request = store.put(entry)

            request.onsuccess = () => {
                console.log(`✓ Cached file search store for document: ${documentId}`)
                resolve()
            }

            request.onerror = () => {
                console.error('Failed to cache file search store:', request.error)
                reject(request.error)
            }
        })
    }

    /**
     * Get a cached file search store ID
     */
    async getFileSearchStore(documentId: string): Promise<FileSearchCacheEntry | null> {
        if (!this.db) {
            await this.initialize()
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readonly')
            const store = transaction.objectStore(STORE_NAME)
            const request = store.get(documentId)

            request.onsuccess = () => {
                const result = request.result
                if (result) {
                    console.log(`✓ Found cached file search store for document: ${documentId}`)
                    resolve(result)
                } else {
                    console.log(`No cached file search store for document: ${documentId}`)
                    resolve(null)
                }
            }

            request.onerror = () => {
                console.error('Failed to retrieve cached file search store:', request.error)
                reject(request.error)
            }
        })
    }

    /**
     * Check if a file has changed by comparing hashes
     */
    async hasFileChanged(documentId: string, currentHash: string): Promise<boolean> {
        const cached = await this.getFileSearchStore(documentId)
        if (!cached || !cached.pdfHash) {
            return true // No cache or no hash - assume changed
        }
        return cached.pdfHash !== currentHash
    }

    /**
     * Get all cached entries
     */
    async getAllCachedStores(): Promise<FileSearchCacheEntry[]> {
        if (!this.db) {
            await this.initialize()
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readonly')
            const store = transaction.objectStore(STORE_NAME)
            const request = store.getAll()

            request.onsuccess = () => {
                console.log(`✓ Retrieved ${request.result.length} cached file search stores`)
                resolve(request.result)
            }

            request.onerror = () => {
                console.error('Failed to retrieve all cached stores:', request.error)
                reject(request.error)
            }
        })
    }

    /**
     * Clear a specific cache entry
     */
    async clearCacheEntry(documentId: string): Promise<void> {
        if (!this.db) {
            await this.initialize()
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
            const store = transaction.objectStore(STORE_NAME)
            const request = store.delete(documentId)

            request.onsuccess = () => {
                console.log(`✓ Cleared cache entry for document: ${documentId}`)
                resolve()
            }

            request.onerror = () => {
                console.error('Failed to clear cache entry:', request.error)
                reject(request.error)
            }
        })
    }

    /**
     * Clear all cached entries
     */
    async clearAllCache(): Promise<void> {
        if (!this.db) {
            await this.initialize()
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
            const store = transaction.objectStore(STORE_NAME)
            const request = store.clear()

            request.onsuccess = () => {
                console.log('✓ Cleared all cached file search stores')
                resolve()
            }

            request.onerror = () => {
                console.error('Failed to clear all cache:', request.error)
                reject(request.error)
            }
        })
    }

    /**
     * Get cache statistics
     */
    async getCacheStats(): Promise<{
        totalEntries: number
        oldestEntry?: FileSearchCacheEntry
        newestEntry?: FileSearchCacheEntry
        totalSize?: number
    }> {
        const allEntries = await this.getAllCachedStores()
        
        if (allEntries.length === 0) {
            return { totalEntries: 0 }
        }

        // Sort by upload date
        allEntries.sort((a, b) => a.uploadDate - b.uploadDate)

        return {
            totalEntries: allEntries.length,
            oldestEntry: allEntries[0],
            newestEntry: allEntries[allEntries.length - 1]
        }
    }

    /**
     * Calculate hash of PDF content (simple implementation)
     */
    static async calculatePDFHash(pdfBase64: string): Promise<string> {
        // Simple hash using Web Crypto API
        const encoder = new TextEncoder()
        const data = encoder.encode(pdfBase64)
        const hashBuffer = await crypto.subtle.digest('SHA-256', data)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
        return hashHex.substring(0, 16) // Use first 16 chars for simplicity
    }
}

// Export singleton instance
export const citationCache = new CitationIndexedDBCache()