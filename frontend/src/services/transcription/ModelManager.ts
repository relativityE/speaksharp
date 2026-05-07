import logger from '@/lib/logger';
import { ENV } from '@/config/TestFlags';

/**
 * ModelManager
 * 
 * Centralized utility for checking the presence of local STT models
 * in the browser's origin-scoped storage.
 * 
 * This allows the STTStrategy to determine Availability (CACHE_MISS)
 * without initializing heavy engine classes.
 */
export class ModelManager {
    private static readonly TRANSFORMERS_CACHE = 'transformers-cache';
    private static readonly WHISPER_TURBO_DB = 'models';
    private static readonly WHISPER_TURBO_MODEL_STORE = 'models';
    private static readonly WHISPER_TURBO_AVAILABLE_STORE = 'availableModels';

    /**
     * Check if the specific model for an engine type is likely present in the cache.
     */
    public static async isModelDownloaded(engineType: 'transformers-js' | 'whisper-turbo'): Promise<boolean> {
        // Browser Environment Check
        if (typeof window === 'undefined') {
            return true; // Assume available in non-browser / server environments
        }

        // 1. Environment Override: Always return true if specifically requested (e.g. legacy fast tests)
        if (ENV.disableWasm) {
            return true;
        }

        try {
            if (engineType === 'whisper-turbo') {
                return await this.isWhisperTurboDownloaded();
            }

            return await this.isTransformersModelDownloaded();
        } catch (error) {
            logger.error({ error, engineType }, '[ModelManager] Error probing cache storage');
            // Fail-safe: Assume not downloaded if cache probing fails
            return false;
        }
    }

    /**
     * Get estimated download size for an engine
     */
    public static getModelSizeMB(engineType: 'transformers-js' | 'whisper-turbo'): number {
        // Sizes are based on whisper-tiny (~40MB transformers, ~75MB turbo WASM+Weights)
        return engineType === 'transformers-js' ? 40 : 75;
    }

    private static async isTransformersModelDownloaded(): Promise<boolean> {
        if (typeof caches === 'undefined') {
            logger.info({ engineType: 'transformers-js' }, '[ModelManager] CacheStorage unavailable');
            return false;
        }

        const hasCache = await caches.has(this.TRANSFORMERS_CACHE);

        if (!hasCache) {
            logger.info({ engineType: 'transformers-js', cacheName: this.TRANSFORMERS_CACHE }, '[ModelManager] Cache not found (First Use)');
            return false;
        }

        const cache = await caches.open(this.TRANSFORMERS_CACHE);
        const keys = await cache.keys();

        if (keys.length === 0) {
            logger.warn({ engineType: 'transformers-js', cacheName: this.TRANSFORMERS_CACHE }, '[ModelManager] Cache exists but is empty');
            return false;
        }

        logger.info({ engineType: 'transformers-js', cacheName: this.TRANSFORMERS_CACHE, keyCount: keys.length }, '[ModelManager] Model detected in cache');
        return true;
    }

    private static async isWhisperTurboDownloaded(): Promise<boolean> {
        if (typeof indexedDB === 'undefined') {
            logger.info({ engineType: 'whisper-turbo' }, '[ModelManager] IndexedDB unavailable');
            return false;
        }

        const hasModel = await this.hasIndexedDbStoreEntries(this.WHISPER_TURBO_DB, this.WHISPER_TURBO_MODEL_STORE);
        const hasAvailableModel = await this.hasIndexedDbStoreEntries(this.WHISPER_TURBO_DB, this.WHISPER_TURBO_AVAILABLE_STORE);
        const isDownloaded = hasModel && hasAvailableModel;

        logger.info({
            engineType: 'whisper-turbo',
            dbName: this.WHISPER_TURBO_DB,
            hasModel,
            hasAvailableModel,
        }, isDownloaded ? '[ModelManager] Whisper Turbo model detected in IndexedDB' : '[ModelManager] Whisper Turbo model missing from IndexedDB');

        return isDownloaded;
    }

    private static async hasIndexedDbStoreEntries(dbName: string, storeName: string): Promise<boolean> {
        return new Promise((resolve) => {
            const request = indexedDB.open(dbName);

            request.onerror = () => resolve(false);
            request.onupgradeneeded = () => {
                request.transaction?.abort();
                resolve(false);
            };
            request.onsuccess = () => {
                const db = request.result;
                try {
                    if (!db.objectStoreNames.contains(storeName)) {
                        db.close();
                        resolve(false);
                        return;
                    }

                    const tx = db.transaction(storeName, 'readonly');
                    const countRequest = tx.objectStore(storeName).count();
                    countRequest.onsuccess = () => resolve(countRequest.result > 0);
                    countRequest.onerror = () => resolve(false);
                    tx.oncomplete = () => db.close();
                    tx.onerror = () => db.close();
                    tx.onabort = () => db.close();
                } catch (error) {
                    logger.warn({ error, dbName, storeName }, '[ModelManager] IndexedDB store probe failed');
                    db.close();
                    resolve(false);
                }
            };
        });
    }
}
