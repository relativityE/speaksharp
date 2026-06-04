import logger from '@/lib/logger';
import { PRIV_STT, PRIV_STT_V4 } from './sttConstants';

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
    private static readonly TRANSFORMERS_MODEL_PATH = 'whisper-tiny.en';
    private static readonly TRANSFORMERS_V4_MODEL_PATH = 'onnx-community/whisper-tiny.en';
    private static readonly TRANSFORMERS_REQUIRED_CACHE_FILES = [
        'config.json',
        'tokenizer.json',
        'preprocessor_config.json',
        'onnx/encoder_model_quantized.onnx',
        'onnx/decoder_model_merged_quantized.onnx',
    ] as const;
    private static readonly TRANSFORMERS_V4_REQUIRED_CACHE_FILES = [
        'config.json',
        'tokenizer.json',
        'preprocessor_config.json',
        'onnx/encoder_model.onnx',
        'onnx/decoder_model_merged_q4.onnx',
    ] as const;
    private static readonly WHISPER_TURBO_DB = 'models';
    private static readonly WHISPER_TURBO_MODEL_STORE = 'models';
    private static readonly WHISPER_TURBO_AVAILABLE_STORE = 'availableModels';

    /**
     * Check if the specific model for an engine type is likely present in the cache.
     */
    public static async isModelDownloaded(engineType: 'transformers-js' | 'transformers-js-v4' | 'whisper-turbo'): Promise<boolean> {
        // Browser Environment Check
        if (typeof window === 'undefined') {
            return true; // Assume available in non-browser / server environments
        }

        try {
            if (engineType === 'whisper-turbo') {
                return await this.isWhisperTurboDownloaded();
            }

            if (engineType === 'transformers-js-v4') {
                return await this.isTransformersV4ModelDownloaded();
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
    public static getModelSizeMB(engineType: 'transformers-js' | 'transformers-js-v4' | 'whisper-turbo'): number {
        // Sizes are based on whisper-tiny (~40MB transformers, ~75MB turbo WASM+Weights)
        if (engineType === 'transformers-js-v4') return PRIV_STT_V4.EXPECTED_Q4_SPLIT_DOWNLOAD_MB;
        return engineType === 'transformers-js' ? PRIV_STT.DEFAULT_MODEL_DOWNLOAD_MB : 75;
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

        const cachedUrls = keys.map((request) => request.url);
        const missingFiles = this.TRANSFORMERS_REQUIRED_CACHE_FILES.filter(
            (requiredFile) => !cachedUrls.some((url) => this.isTransformersModelAsset(url, requiredFile)),
        );

        if (missingFiles.length > 0) {
            logger.warn({
                engineType: 'transformers-js',
                cacheName: this.TRANSFORMERS_CACHE,
                keyCount: keys.length,
                missingFiles,
            }, '[ModelManager] Cache exists but required model assets are missing');
            return false;
        }

        logger.info({ engineType: 'transformers-js', cacheName: this.TRANSFORMERS_CACHE, keyCount: keys.length }, '[ModelManager] Required model assets detected in cache');
        return true;
    }

    private static isTransformersModelAsset(url: string, requiredFile: string): boolean {
        try {
            const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
            const pathname = decodeURIComponent(parsed.pathname);
            return pathname.includes(this.TRANSFORMERS_MODEL_PATH) && pathname.endsWith(requiredFile);
        } catch (error) {
            logger.debug({
                error,
                url,
                requiredFile,
            }, '[ModelManager] Cache URL parse failed; falling back to string asset matching');
            return url.includes(this.TRANSFORMERS_MODEL_PATH) && url.split('?')[0]?.endsWith(requiredFile);
        }
    }

    private static async isTransformersV4ModelDownloaded(): Promise<boolean> {
        if (typeof caches === 'undefined') {
            logger.info({ engineType: 'transformers-js-v4' }, '[ModelManager] CacheStorage unavailable');
            return false;
        }

        const hasCache = await caches.has(this.TRANSFORMERS_CACHE);

        if (!hasCache) {
            logger.info({ engineType: 'transformers-js-v4', cacheName: this.TRANSFORMERS_CACHE }, '[ModelManager] Cache not found (First Use)');
            return false;
        }

        const cache = await caches.open(this.TRANSFORMERS_CACHE);
        const keys = await cache.keys();

        if (keys.length === 0) {
            logger.warn({ engineType: 'transformers-js-v4', cacheName: this.TRANSFORMERS_CACHE }, '[ModelManager] Cache exists but is empty');
            return false;
        }

        const cachedUrls = keys.map((request) => request.url);
        const missingFiles = this.TRANSFORMERS_V4_REQUIRED_CACHE_FILES.filter(
            (requiredFile) => !cachedUrls.some((url) => this.isTransformersV4ModelAsset(url, requiredFile)),
        );

        if (missingFiles.length > 0) {
            logger.warn({
                engineType: 'transformers-js-v4',
                cacheName: this.TRANSFORMERS_CACHE,
                keyCount: keys.length,
                missingFiles,
            }, '[ModelManager] Cache exists but required v4 model assets are missing');
            return false;
        }

        logger.info({ engineType: 'transformers-js-v4', cacheName: this.TRANSFORMERS_CACHE, keyCount: keys.length }, '[ModelManager] Required v4 model assets detected in cache');
        return true;
    }

    private static isTransformersV4ModelAsset(url: string, requiredFile: string): boolean {
        try {
            const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
            const pathname = decodeURIComponent(parsed.pathname);
            return pathname.includes(this.TRANSFORMERS_V4_MODEL_PATH) && pathname.endsWith(requiredFile);
        } catch (error) {
            logger.debug({
                error,
                url,
                requiredFile,
            }, '[ModelManager] V4 cache URL parse failed; falling back to string asset matching');
            return url.includes(this.TRANSFORMERS_V4_MODEL_PATH) && url.split('?')[0]?.endsWith(requiredFile);
        }
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
            request.onblocked = () => {
                logger.warn({ dbName, storeName }, '[ModelManager] IndexedDB open blocked by another tab');
                resolve(false);
            };
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
