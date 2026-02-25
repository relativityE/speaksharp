import { SessionManager, AvailableModels } from 'whisper-turbo';
import logger from '../../../lib/logger';

/**
 * [EXPAT] WhisperEngineRegistry
 * 
 * A singleton manager that holds the "Hot" Whisper-Turbo engine.
 * Prevents re-compiling 80MB WASM and reloading models on every service instantiation.
 * 
 * Northern Architecture: System Integrity over Developer Velocity.
 */
export class WhisperEngineRegistry {
    private static manager: SessionManager | null = null;
    private static session: unknown | null = null;
    private static refCount = 0;
    private static isLocked = false;
    private static initPromise: Promise<unknown> | null = null;
    public static WARMUP_TIMEOUT = 30000; // 30 seconds default
    private static progressListeners = new Set<(progress: number) => void>();

    /**
     * Acquires the singleton Whisper session.
     * If the engine isn't warmed up, it starts the initialization.
     */
    public static async acquire(onProgress?: (progress: number) => void): Promise<unknown> {
        if (onProgress) {
            this.progressListeners.add(onProgress);
        }

        if (this.isLocked) {
            logger.warn('[WhisperRegistry] Attempted to acquire engine while locked');
            throw new Error('Engine already in use by another session');
        }

        if (this.session) {
            logger.info('[WhisperRegistry] Reusing warmed engine');
            this.refCount++;
            this.isLocked = true;
            return this.session;
        }

        if (this.initPromise) {
            logger.info('[WhisperRegistry] Waiting for existing initialization...');
            try {
                return await this.initPromise;
            } finally {
                if (onProgress) this.progressListeners.delete(onProgress);
            }
        }

        // Use polyfill with proper cleanup to prevent IPC leaks
        this.initPromise = this.acquireWithPolyfill(onProgress);

        try {
            this.session = await this.initPromise;
            this.refCount++;
            this.isLocked = true;
            this.initPromise = null;
            return this.session;
        } catch (error) {
            logger.error({ error }, '[WhisperRegistry] Failed to warmup engine');
            this.initPromise = null;
            this.isLocked = false;
            throw error;
        } finally {
            if (onProgress) this.progressListeners.delete(onProgress);
        }
    }

    private static async acquireWithPolyfill(_onProgress?: (progress: number) => void): Promise<unknown> {
        const channel = new BroadcastChannel('whisper-coordination');
        let pingListener: ((event: MessageEvent) => void) | null = null;

        try {
            // coordination contract: 
            // 1. send ping
            // 2. if we get a pong within 100ms, another tab has the engine.
            const hasExistingSession = await new Promise<boolean>((resolve) => {
                const coordinationListener = (event: MessageEvent) => {
                    if (event.data.type === 'acquire-pong') {
                        channel.removeEventListener('message', coordinationListener);
                        resolve(true); // Another tab responded within 100ms
                    }
                };
                channel.addEventListener('message', coordinationListener);
                channel.postMessage({ type: 'acquire-ping' });

                // If no one pongs in 100ms, assume we are the primary holder
                setTimeout(() => {
                    channel.removeEventListener('message', coordinationListener);
                    resolve(false);
                }, 100);
            });

            if (hasExistingSession) {
                throw new Error('WebGPU in use by another tab');
            }

            // Successfully coordination: Listen for future pings to protect our acquisition
            pingListener = (event: MessageEvent) => {
                if (event.data.type === 'acquire-ping') {
                    channel.postMessage({ type: 'acquire-pong' });
                }
            };
            channel.addEventListener('message', pingListener);

            // Acquire the engine
            return await this.warmupWithTimeout(this.WARMUP_TIMEOUT);

        } finally {
            // CRITICAL FIX: Always clean up handles to fix the CI IPC leak.
            // If the process is exiting or during teardown, this handle MUST be closed.
            if (pingListener) {
                channel.removeEventListener('message', pingListener);
            }
            channel.close();
            logger.debug('[WhisperEngineRegistry] BroadcastChannel closed');
        }
    }

    private static async warmupWithTimeout(ms: number): Promise<unknown> {
        return Promise.race([
            this.warmupEngine(),
            new Promise<never>((_, reject) => {
                setTimeout(() => {
                    reject(new Error(
                        `Whisper engine initialization timed out after ${ms}ms. ` +
                        `Possible causes: 1) WASM assets missing from /whisper-turbo/, 2) Worker script failed to load, 3) Network blocking large downloads.`
                    ));
                }, ms);
            })
        ]);
    }

    private static async warmupEngine(): Promise<unknown> {
        logger.info('[WhisperRegistry] [PERF] First-time engine warmup starting...');
        const startTime = performance.now();

        if (!this.manager) {
            this.manager = new SessionManager();
        }

        // 🛡️ [System Integrity] Pre-flight Asset Probe
        // Verify all required assets are reachable before committing to the worker handshake.
        const assetsToProbe = [
            '/whisper-turbo/session.worker.js',
            '/whisper-turbo/whisper-wasm_bg.wasm',
            '/models/tokenizer.json',
            '/models/tiny-q8g16.bin'
        ];

        logger.info({ assets: assetsToProbe }, '[WhisperRegistry] 🔍 Probing asset chain...');
        await Promise.all(assetsToProbe.map(async (url) => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                const resp = await fetch(new URL(url, window.location.origin).href, {
                    method: 'HEAD',
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!resp.ok) {
                    throw new Error(`Asset not found: ${url} (Status: ${resp.status})`);
                }
                logger.debug(`[WhisperRegistry] Asset OK: ${url}`);
            } catch (e) {
                const isTimeout = e instanceof Error && e.name === 'AbortError';
                const errorMsg = isTimeout ? `Asset probe TIMEOUT (5s): ${url}` : `Asset Probe Failed: ${url}`;
                logger.error({ url, err: e, isTimeout }, `[WhisperRegistry] ❌ ${errorMsg}`);
                throw new Error(errorMsg);
            }
        }));

        // Use loadModel with mandatory callbacks
        const modelResult = await this.manager.loadModel(
            AvailableModels.WHISPER_TINY,
            () => logger.info('[WhisperRegistry] Model loaded.'),
            (progress) => {
                logger.debug({ progress }, '[WhisperRegistry] Loading...');
                this.progressListeners.forEach(cb => cb(progress));
            }
        );

        if (modelResult.isErr) {
            throw modelResult.error;
        }

        const duration = performance.now() - startTime;
        logger.info({ durationMs: duration.toFixed(2) }, '[WhisperRegistry] [PERF] Engine warmed up successfully');

        return modelResult.value;
    }

    private static purgeTimeout: NodeJS.Timeout | null = null;
    private static GRACE_PERIOD_MS = 60000; // 1 minute

    /**
     * Releases the engine, making it available for other services.
     * Starts a grace period timer to purge the engine if not re-acquired.
     */
    public static release() {
        logger.info({ refCount: this.refCount }, '[WhisperRegistry] Releasing engine');
        this.isLocked = false;
        this.refCount = Math.max(0, this.refCount - 1);

        if (this.refCount === 0) {
            logger.info(`[WhisperRegistry] Engine idle. Starting ${this.GRACE_PERIOD_MS / 1000}s grace period before purge.`);
            if (this.purgeTimeout) clearTimeout(this.purgeTimeout);
            this.purgeTimeout = setTimeout(() => {
                if (this.refCount === 0) {
                    logger.info('[WhisperRegistry] Grace period expired. Purging now.');
                    this.purge();
                }
            }, this.GRACE_PERIOD_MS);
        }
    }

    /**
     * Forcibly destroys the engine and workers.
     * Used for memory cleanup or hard resets.
     */
    public static async purge(): Promise<void> {
        logger.info('[WhisperRegistry] Purging engine and workers');

        if (this.session) {
            try {
                await (this.session as { destroy: () => Promise<void> }).destroy();
            } catch (e) {
                logger.warn({ error: e }, '[WhisperRegistry] Error during session destruction');
            }
        }

        if (this.manager) {
            try {
                // EXPAT: manager.terminate() is critical to kill zombie workers
                const m = this.manager as unknown as { terminate?: () => Promise<void> };
                await m.terminate?.();
            } catch (e) {
                logger.warn({ error: e }, '[WhisperRegistry] Error terminating manager');
            }
        }

        this.session = null;
        this.manager = null;
        this.refCount = 0;
        this.isLocked = false;
        this.initPromise = null;
    }
}
