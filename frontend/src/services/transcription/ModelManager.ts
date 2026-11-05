import logger from '@/lib/logger';
import { PRIV_STT_V4, PRIV_STT_MODELS } from './sttConstants';
import { resolvePrivateModel } from './utils/privateModelFlag';
import { CANDIDATES } from './candidateRegistry';
import { VERIFIED_MODEL_CACHE } from './verifiedAssetFetch';

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
    // Every cache a loader may have written the model to: the library's own cache (the incumbent) and the verified loaders' cache
    // (v4 and package-v2 candidates load with useBrowserCache=false and store digest-verified responses there). Probing only the first
    // reported CACHE_MISS after every successful candidate load.
    private static readonly MODEL_CACHES = [this.TRANSFORMERS_CACHE, VERIFIED_MODEL_CACHE] as const;

    /** The URLs of every entry in every model cache that exists; [] when none does or CacheStorage is unavailable. */
    private static async cachedModelUrls(): Promise<string[]> {
        const urls: string[] = [];
        for (const name of this.MODEL_CACHES) {
            if (!(await caches.has(name))) continue;
            const cache = await caches.open(name);
            urls.push(...(await cache.keys()).map((request) => request.url));
        }
        return urls;
    }
    // Model-aware: track the SELECTED Private model so cache-detection + size gate the download/ready
    // UX on what will actually load. The default is PRIV_STT_MODELS.DEFAULT — v2 whisper-base.en
    // (~80MB, self-hosted under public/models/, no Hugging Face). tiny.en remains an internal/emergency
    // CANDIDATE only. (resolvePrivateModel is side-effect-free and total — it returns the default.)
    private static get TRANSFORMERS_MODEL_PATH(): string {
        return PRIV_STT_MODELS.CANDIDATES[resolvePrivateModel()].localId;
    }

    /**
     * Check if the specific model for an engine type is likely present in the cache.
     */
    /**
     * Is the model for `engineType` present in cache?
     *
     * `modelPath` is the REPOSITORY the selected candidate actually loads. It used to be fixed to
     * `PRIV_STT_V4.MODEL_ID` (whisper-base.en), so a build configured for distil probed base-q4's
     * files: readiness reported "downloaded" when base happened to be cached and distil was not, and
     * "missing" when base was absent even though distil was there. Either way the UI described a model
     * the session was not going to run — the same intention-vs-reality gap as reporting a size for the
     * wrong model.
     */
    public static async isModelDownloaded(
        engineType: 'transformers-js' | 'transformers-js-v4',
        modelPath?: string,
        requiredFiles?: readonly string[],
    ): Promise<boolean> {
        // Browser Environment Check
        if (typeof window === 'undefined') {
            return true; // Assume available in non-browser / server environments
        }

        try {
            const selectedPath = modelPath ?? (engineType === 'transformers-js-v4'
                ? PRIV_STT_V4.MODEL_ID : this.TRANSFORMERS_MODEL_PATH);
            if (!requiredFiles) {
                const matches = Object.values(CANDIDATES).filter(candidate =>
                    candidate.engine === engineType && candidate.execution.implemented &&
                    (candidate.execution.localModelId ?? candidate.model.id) === selectedPath);
                // A repository shared by different exports cannot identify its cache requirements.
                if (matches.length !== 1) return false;
                requiredFiles = matches[0].execution.cacheFiles;
            }
            if (!requiredFiles?.length) return false;
            if (engineType === 'transformers-js-v4') {
                return await this.isTransformersV4ModelDownloaded(selectedPath, requiredFiles);
            }

            return await this.isTransformersModelDownloaded(selectedPath, requiredFiles);
        } catch (error) {
            logger.error({ error, engineType }, '[ModelManager] Error probing cache storage');
            // Fail-safe: Assume not downloaded if cache probing fails
            return false;
        }
    }

    /**
     * Get estimated download size for an engine
     */
    public static getModelSizeMB(
        engineType: 'transformers-js' | 'transformers-js-v4',
        v4SizeMB: number = PRIV_STT_V4.EXPECTED_Q4_SPLIT_DOWNLOAD_MB,
    ): number {
        // transformers-js is model-aware — report the SELECTED model's size (default base.en
        // ~80MB, or tiny.en ~40MB) so the download consent CTA shows the accurate size for what
        // will actually download.
        if (engineType === 'transformers-js-v4') return v4SizeMB;
        return PRIV_STT_MODELS.CANDIDATES[resolvePrivateModel()].approxMB;
    }

    private static async isTransformersModelDownloaded(modelPath: string, requiredFiles: readonly string[]): Promise<boolean> {
        if (typeof caches === 'undefined') {
            logger.info({ engineType: 'transformers-js' }, '[ModelManager] CacheStorage unavailable');
            return false;
        }

        const cachedUrls = await this.cachedModelUrls();

        if (cachedUrls.length === 0) {
            logger.info({ engineType: 'transformers-js', cacheNames: this.MODEL_CACHES }, '[ModelManager] No model cache entries (First Use)');
            return false;
        }

        const missingFiles = requiredFiles.filter(
            (requiredFile) => !cachedUrls.some((url) => this.isTransformersModelAsset(url, requiredFile, modelPath)),
        );

        if (missingFiles.length > 0) {
            logger.warn({
                engineType: 'transformers-js',
                cacheNames: this.MODEL_CACHES,
                keyCount: cachedUrls.length,
                missingFiles,
            }, '[ModelManager] Cache exists but required model assets are missing');
            return false;
        }

        logger.info({ engineType: 'transformers-js', cacheNames: this.MODEL_CACHES, keyCount: cachedUrls.length }, '[ModelManager] Required model assets detected in cache');
        return true;
    }

    private static isTransformersModelAsset(url: string, requiredFile: string, modelPath: string): boolean {
        try {
            const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
            const pathname = decodeURIComponent(parsed.pathname);
            return pathname.includes(modelPath) && pathname.endsWith(requiredFile);
        } catch (error) {
            logger.debug({
                error,
                url,
                requiredFile,
            }, '[ModelManager] Cache URL parse failed; falling back to string asset matching');
            return url.includes(modelPath) && url.split('?')[0]?.endsWith(requiredFile);
        }
    }

    private static async isTransformersV4ModelDownloaded(modelPath: string, requiredFiles: readonly string[]): Promise<boolean> {
        if (typeof caches === 'undefined') {
            logger.info({ engineType: 'transformers-js-v4' }, '[ModelManager] CacheStorage unavailable');
            return false;
        }

        const cachedUrls = await this.cachedModelUrls();

        if (cachedUrls.length === 0) {
            logger.info({ engineType: 'transformers-js-v4', cacheNames: this.MODEL_CACHES }, '[ModelManager] No model cache entries (First Use)');
            return false;
        }

        const missingFiles = requiredFiles.filter(
            (requiredFile) => !cachedUrls.some((url) => this.isTransformersV4ModelAsset(url, requiredFile, modelPath)),
        );

        if (missingFiles.length > 0) {
            logger.warn({
                engineType: 'transformers-js-v4',
                cacheNames: this.MODEL_CACHES,
                keyCount: cachedUrls.length,
                missingFiles,
            }, '[ModelManager] Cache exists but required v4 model assets are missing');
            return false;
        }

        logger.info({ engineType: 'transformers-js-v4', cacheNames: this.MODEL_CACHES, keyCount: cachedUrls.length }, '[ModelManager] Required v4 model assets detected in cache');
        return true;
    }

    private static isTransformersV4ModelAsset(url: string, requiredFile: string, modelPath: string): boolean {
        try {
            const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
            const pathname = decodeURIComponent(parsed.pathname);
            return pathname.includes(modelPath) && pathname.endsWith(requiredFile);
        } catch (error) {
            logger.debug({
                error,
                url,
                requiredFile,
            }, '[ModelManager] V4 cache URL parse failed; falling back to string asset matching');
            // The FALLBACK must use the same model path as the parsed branch. Leaving the fixed
            // constant here would have made a URL that failed to parse silently revert to probing
            // whisper-base.en — the defect surviving in the error path only.
            return url.includes(modelPath) && url.split('?')[0]?.endsWith(requiredFile);
        }
    }

}
