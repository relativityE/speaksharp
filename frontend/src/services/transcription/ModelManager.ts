import logger from '@/lib/logger';
import { PRIV_STT_V4, PRIV_STT_MODELS } from './sttConstants';
import { resolvePrivateModel } from './utils/privateModelFlag';

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
    // Model-aware: track the SELECTED Private model (default tiny.en, or an opt-in candidate
    // like base.en via ?privateModel=) so cache-detection + size gate the download/ready UX on
    // what will actually load. The no-flag default path resolves to tiny.en (bundled, ~40MB, no
    // download wall); base.en opt-in resolves to its own remote ~145MB path. (resolvePrivateModel
    // is side-effect-free and total — returns the default when no flag is set.)
    private static get TRANSFORMERS_MODEL_PATH(): string {
        return PRIV_STT_MODELS.CANDIDATES[resolvePrivateModel()].localId;
    }
    // Derive from the canonical v4 model id (base_q4 rollout floor) — v4 has no tiny variant.
    private static readonly TRANSFORMERS_V4_MODEL_PATH = PRIV_STT_V4.MODEL_ID;
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

    /**
     * Check if the specific model for an engine type is likely present in the cache.
     */
    public static async isModelDownloaded(engineType: 'transformers-js' | 'transformers-js-v4'): Promise<boolean> {
        // Browser Environment Check
        if (typeof window === 'undefined') {
            return true; // Assume available in non-browser / server environments
        }

        try {
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
    public static getModelSizeMB(engineType: 'transformers-js' | 'transformers-js-v4'): number {
        // transformers-js is model-aware — report the SELECTED model's size (default base.en
        // ~80MB, or tiny.en ~40MB) so the download consent CTA shows the accurate size for what
        // will actually download.
        if (engineType === 'transformers-js-v4') return PRIV_STT_V4.EXPECTED_Q4_SPLIT_DOWNLOAD_MB;
        return PRIV_STT_MODELS.CANDIDATES[resolvePrivateModel()].approxMB;
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

}
