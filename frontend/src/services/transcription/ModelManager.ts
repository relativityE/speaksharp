import logger from '@/lib/logger';
import { ENV } from '@/config/TestFlags';

/**
 * ModelManager
 * 
 * Centralized utility for checking the presence of local STT models
 * (WASM and Weights) in the browser's CacheStorage.
 * 
 * This allows the STTStrategy to determine Availability (CACHE_MISS)
 * without initializing heavy engine classes.
 */
export class ModelManager {
    private static readonly TRANSFORMERS_CACHE = 'transformers-cache';
    // whisper-turbo uses its own internal cache name, usually prefixed or predictable
    private static readonly WHISPER_TURBO_CACHE = 'whisper-turbo-cache';

    /**
     * Check if the specific model for an engine type is likely present in the cache.
     */
    public static async isModelDownloaded(engineType: 'transformers-js' | 'whisper-turbo'): Promise<boolean> {
        // Browser Environment Check
        if (typeof window === 'undefined' || typeof caches === 'undefined') {
            return true; // Assume available in non-browser / server environments
        }

        // 1. Environment Override: Always return true if specifically requested (e.g. legacy fast tests)
        if (ENV.disableWasm) {
            return true;
        }

        try {
            const cacheName = engineType === 'transformers-js' ? this.TRANSFORMERS_CACHE : this.WHISPER_TURBO_CACHE;
            const hasCache = await caches.has(cacheName);
            
            if (!hasCache) {
                logger.info({ engineType, cacheName }, '[ModelManager] Cache not found (First Use)');
                return false;
            }

            // 3. Structural probing (Optional: check for specific keys)
            // For now, presence of the cache is our proxy for "Downloaded"
            const cache = await caches.open(cacheName);
            const keys = await cache.keys();
            
            if (keys.length === 0) {
                logger.warn({ engineType, cacheName }, '[ModelManager] Cache exists but is empty');
                return false;
            }

            logger.info({ engineType, cacheName, keyCount: keys.length }, '[ModelManager] Model detected in cache');
            return true;
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
}
