import logger from '@/lib/logger';
import { PRIV_STT_V4, PRIV_STT_MODELS } from './sttConstants';
import { resolvePrivateModel } from './utils/privateModelFlag';
import { CANDIDATES, type Candidate } from './candidateRegistry';
import { VERIFIED_MODEL_CACHE } from './verifiedAssetFetch';
import { modelResponsePins } from './candidateAssetRequests';

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

    // Model-aware: track the SELECTED Private model so cache-detection + size gate the download/ready
    // UX on what will actually load. The default is PRIV_STT_MODELS.DEFAULT — v2 whisper-base.en
    // (~80MB, self-hosted under public/models/, no Hugging Face). tiny.en remains an internal/emergency
    // CANDIDATE only. (resolvePrivateModel is side-effect-free and total — it returns the default.)
    private static get TRANSFORMERS_MODEL_PATH(): string {
        return PRIV_STT_MODELS.CANDIDATES[resolvePrivateModel()].localId;
    }

    /**
     * Is the model for `engineType` present in cache?
     *
     * `modelPath` is the REPOSITORY the selected candidate actually loads. It used to be fixed to
     * `PRIV_STT_V4.MODEL_ID` (whisper-base.en), so a build configured for distil probed base-q4's
     * files: readiness reported "downloaded" when base happened to be cached and distil was not, and
     * "missing" when base was absent even though distil was there. Either way the UI described a model
     * the session was not going to run — the same intention-vs-reality gap as reporting a size for the
     * wrong model.
     *
     * READY MEANS THE SELECTED LOADER WILL READ EVERY REQUIRED FILE FROM CACHE. Readiness used to compare a
     * decoded pathname across both caches, so an entry under another origin, another Hub revision, a query
     * string, or the cache the loader does not read reported READY while the loader would still go to the
     * network (PO finding on c821ccf6). It now derives the exact cache name and exact request URLs from the
     * selected loader (see cacheIdentity) and requires each URL as an exact key in that one cache.
     */
    public static async isModelDownloaded(
        engineType: 'transformers-js' | 'transformers-js-v4',
        modelPath?: string,
        requiredFiles?: readonly string[],
        candidate?: Candidate,
    ): Promise<boolean> {
        // Browser Environment Check
        if (typeof window === 'undefined') {
            return true; // Assume available in non-browser / server environments
        }

        try {
            const selectedPath = modelPath ?? (engineType === 'transformers-js-v4'
                ? PRIV_STT_V4.MODEL_ID : this.TRANSFORMERS_MODEL_PATH);
            let selected = candidate;
            if (!selected) {
                const matches = Object.values(CANDIDATES).filter(entry =>
                    entry.engine === engineType && entry.execution.implemented &&
                    (entry.execution.localModelId ?? entry.model.id) === selectedPath);
                // A repository shared by different exports cannot identify its cache requirements.
                if (matches.length === 1) selected = matches[0];
                else if (!requiredFiles) return false;
            }
            requiredFiles ??= selected?.execution.cacheFiles;
            if (!requiredFiles?.length) return false;
            const identity = this.cacheIdentity(engineType, selectedPath, requiredFiles, selected);
            if (!identity) return false;
            return await this.cachedExactly(identity.cacheName, identity.urls, engineType);
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

    /**
     * The one cache and the exact request URLs the SELECTED loader reads, or null when they cannot be named.
     *
     * - Built-in v2 (the incumbent; library loader, useBrowserCache): Xenova 2.17.2 looks up and stores
     *   `/models/<model>/<file>` in `transformers-cache`, resolved against this origin, with no query.
     * - v4 and imported v2 packages (verified loaders, useBrowserCache=false): the verified fetch looks up
     *   exactly the PINNED request URL in VERIFIED_MODEL_CACHE and refuses any other URL in its scope. Each
     *   required file must therefore map to exactly one pin in the loader's scope (v4: the Hub repository's
     *   `resolve/<revision>/`; packages: the package's served directory).
     */
    private static cacheIdentity(engineType: 'transformers-js' | 'transformers-js-v4', modelPath: string,
        requiredFiles: readonly string[], candidate: Candidate | undefined): { cacheName: string; urls: string[] } | null {
        const safe = (value: string) => !!value && value.split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..');
        if (!safe(modelPath) || !requiredFiles.every(safe)) return null;
        if (engineType === 'transformers-js' && !candidate?.modelPackage) {
            return { cacheName: this.TRANSFORMERS_CACHE,
                urls: requiredFiles.map(file => new URL(`/models/${modelPath}/${file}`, window.location.origin).href) };
        }
        if (!candidate) return null;
        const scope = engineType === 'transformers-js-v4'
            ? `https://huggingface.co/${modelPath}/resolve/`
            : new URL(`${candidate.assets.servedFrom}/`, window.location.origin).href;
        const pins = modelResponsePins(candidate).map(pin => pin.url);
        const urls: string[] = [];
        for (const file of requiredFiles) {
            const matches = pins.filter(url => {
                if (!url.startsWith(scope) || url.includes('?') || url.includes('#')) return false;
                const rest = url.slice(scope.length);
                if (engineType !== 'transformers-js-v4') return rest === file;
                const slash = rest.indexOf('/');
                return slash > 0 && rest.slice(slash + 1) === file;
            });
            if (matches.length !== 1) return null;
            urls.push(matches[0]);
        }
        return { cacheName: VERIFIED_MODEL_CACHE, urls };
    }

    /** Every URL is an exact key (origin, path and query) in the one named cache. */
    private static async cachedExactly(cacheName: string, urls: readonly string[], engineType: string): Promise<boolean> {
        if (typeof caches === 'undefined') return false;
        if (!(await caches.has(cacheName))) {
            logger.info({ engineType, cacheName }, '[ModelManager] No model cache entries (First Use)');
            return false;
        }
        const keys = new Set((await (await caches.open(cacheName)).keys()).map(request => request.url));
        const missing = urls.filter(url => !keys.has(url)).length;
        if (missing > 0) {
            logger.warn({ engineType, cacheName, keyCount: keys.size, missingCount: missing },
                '[ModelManager] Cache exists but required model assets are missing');
            return false;
        }
        logger.info({ engineType, cacheName, keyCount: keys.size }, '[ModelManager] Required model assets detected in cache');
        return true;
    }
}
