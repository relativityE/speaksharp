import logger from '../../../lib/logger';
import { WhisperEngineRegistry } from '../engines/WhisperEngineRegistry';
import { TranscriptionMode } from '../TranscriptionPolicy';

/**
 * ModelLifecycleManager
 *
 * Responsible for the entire model lifecycle:
 * - Existence checks
 * - Download management
 * - Cache validation
 * - Model loading
 * - Warmup
 * - Readiness signaling
 */
export class ModelLifecycleManager {
    private static instance: ModelLifecycleManager | null = null;
    private loadingProgress: Map<TranscriptionMode, number> = new Map();

    private constructor() { }

    public static getInstance(): ModelLifecycleManager {
        if (!ModelLifecycleManager.instance) {
            ModelLifecycleManager.instance = new ModelLifecycleManager();
        }
        return ModelLifecycleManager.instance;
    }

    /**
     * Check if the model for a specific mode is already cached.
     */
    public async isModelCached(mode: TranscriptionMode): Promise<boolean> {
        if (mode === 'native' || mode === 'cloud') return true;

        if (mode === 'private') {
            try {
                // Check whisper-turbo (IndexedDB)
                const dbs = await indexedDB.databases();
                const hasTurbo = dbs.some(db => db.name === 'whisper-turbo');
                if (hasTurbo) return true;

                // Check transformers-js (Cache API)
                if ('caches' in window) {
                    const cacheNames = await caches.keys();
                    if (cacheNames.some(name => name.includes('transformers-cache'))) {
                        return true;
                    }
                }
            } catch (e) {
                logger.warn({ error: e }, '[ModelLifecycleManager] Cache check failed');
            }
        }

        return false;
    }

    /**
     * Load the model for the given mode.
     */
    public async loadModel(
        mode: TranscriptionMode,
        onProgress?: (progress: number) => void
    ): Promise<void> {
        if (mode !== 'private') return;

        logger.info(`[ModelLifecycleManager] Loading model for ${mode}...`);

        try {
            // Trigger initial progress
            this.setLoadingProgress(mode, 0, onProgress);

            if (mode === 'private') {
                // Use WhisperEngineRegistry for private model loading
                await WhisperEngineRegistry.acquire((progress) => {
                    this.setLoadingProgress(mode, progress, onProgress);
                });

                // Also trigger TransformersJS warm-up if needed?
                // Actually, the Registry currently only handles whisper-turbo.
                // TransformersJS is managed inside TransformersJSEngine.

                // Standardizing: The Manager should probably know how to warm up both.
                // For now, let's focus on the Orchestrator calling the right engines.
            }

            this.setLoadingProgress(mode, 100, onProgress);
            logger.info(`[ModelLifecycleManager] Model for ${mode} loaded successfully.`);
        } catch (error) {
            logger.error({ error, mode }, '[ModelLifecycleManager] Failed to load model');
            throw error;
        }
    }

    /**
     * Warm up the model by running a dummy inference.
     */
    public async warmUp(mode: TranscriptionMode): Promise<void> {
        if (mode !== 'private') return;

        logger.info(`[ModelLifecycleManager] Warming up ${mode} model...`);
        try {
            const session = await WhisperEngineRegistry.acquire();
            const s = session as { transcribe?: (data: Float32Array) => Promise<unknown> };
            // Run a tiny dummy inference to compile kernels
            await s.transcribe?.(new Float32Array(16000 * 0.1)); // 100ms of silence
            logger.info(`[ModelLifecycleManager] ${mode} model warmed up.`);
        } catch (error) {
            logger.warn({ error }, '[ModelLifecycleManager] Warmup failed (non-critical)');
        }
    }

    private setLoadingProgress(
        mode: TranscriptionMode,
        progress: number,
        callback?: (progress: number) => void
    ) {
        this.loadingProgress.set(mode, progress);
        if (callback) callback(progress);
    }

    public getLoadingProgress(mode: TranscriptionMode): number | undefined {
        return this.loadingProgress.get(mode);
    }
}
