import { SessionManager, AvailableModels } from 'whisper-turbo';
import logger from '../../../lib/logger';

export enum RegistryState {
    Idle = 'idle',
    Initializing = 'initializing',
    Available = 'available',
    Busy = 'busy',
    Destroyed = 'destroyed'
}

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
    private static state: RegistryState = RegistryState.Idle;
    private static abortController: AbortController | null = null;
    private static initPromise: Promise<unknown> | null = null;
    private static activeWarmupPromise: Promise<unknown> | null = null;
    public static WARMUP_SLOW_WARNING_MS = 5000;
    public static WARMUP_TIMEOUT = 30000; // Hard ceiling for genuinely stuck setup.
    private static progressListeners = new Set<(progress: number) => void>();
    private static heartbeatInterval: NodeJS.Timeout | null = null;
    private static webLockRelease: (() => void) | null = null;
    private static coordinationChannel: BroadcastChannel | null = null;
    private static coordinationPingListener: ((event: MessageEvent) => void) | null = null;

    private static getChannelName(): string {
        // Use unique names in test to prevent cross-process coordination collisions
        const suffix = process.env.NODE_ENV === 'test' ? `-${process.pid}` : '';
        return `whisper-coordination${suffix}`;
    }

    /**
     * Acquires the singleton Whisper session.
     * If the engine isn't warmed up, it starts the initialization.
     */
    public static async acquire(onProgress?: (progress: number) => void): Promise<unknown> {
        if (onProgress) {
            this.progressListeners.add(onProgress);
        }

        if (this.state === RegistryState.Busy) {
            logger.warn('[WhisperRegistry] Attempted to acquire engine while busy');
            throw new Error('Engine already in use by another session');
        }

        if (this.state === RegistryState.Available && this.session) {
            logger.info('[WhisperRegistry] Reusing warmed engine');
            this.refCount++;
            this.state = RegistryState.Busy;
            return this.session;
        }

        if (this.state === RegistryState.Initializing && this.initPromise) {
            logger.info('[WhisperRegistry] Waiting for existing initialization...');
            try {
                return await Promise.race([
                    this.initPromise,
                    new Promise((_, reject) => {
                        const timeout = setTimeout(
                            () => reject(new Error('Registry deadlock detected during wait')),
                            this.WARMUP_TIMEOUT
                        );
                        if (typeof timeout.unref === 'function') {
                            timeout.unref();
                        }
                    })
                ]);
            } finally {
                if (onProgress) this.progressListeners.delete(onProgress);
            }
        }

        // Trigger initialization
        this.initPromise = this.acquireWithCoordination(onProgress);

        try {
            this.session = await this.initPromise;
            this.refCount++;
            this.state = RegistryState.Busy;
            this.initPromise = null;
            this.startHeartbeat();
            return this.session;
        } catch (error) {
            logger.error({ error }, '[WhisperRegistry] Failed to warmup engine');
            this.initPromise = null;
            this.state = RegistryState.Idle;
            throw error;
        } finally {
            if (onProgress) this.progressListeners.delete(onProgress);
        }
    }

    /**
     * Coordination pattern to prevent multiple tabs from initializing the engine simultaneously.
     */
    private static async acquireWithCoordination(_onProgress?: (progress: number) => void): Promise<unknown> {
        // Use Web Locks if available (modern, stable)
        if (typeof navigator !== 'undefined' && navigator.locks) {
            return new Promise<unknown>((resolve, reject) => {
                navigator.locks.request(this.getChannelName(), { ifAvailable: true }, async (lock) => {
                    if (!lock) {
                        reject(new Error('WebGPU in use by another tab'));
                        return;
                    }

                    try {
                        this.state = RegistryState.Initializing;
                        const warmedSession = await this.warmupWithTimeout(this.WARMUP_TIMEOUT);
                        resolve(warmedSession);

                        // Keep the browser-level lock while the warmed session is actively held.
                        await new Promise<void>((release) => {
                            this.webLockRelease = release;
                        });
                    } catch (error) {
                        reject(error);
                    } finally {
                        this.webLockRelease = null;
                    }
                }).catch(reject);
            });
        }

        // Fallback to BroadcastChannel coordination (legacy/older browsers)
        if (typeof BroadcastChannel === 'undefined') {
            this.state = RegistryState.Initializing;
            return await this.warmupWithTimeout(this.WARMUP_TIMEOUT);
        }

        const channel = new BroadcastChannel(this.getChannelName());

        try {
            const hasExistingSession = await new Promise<boolean>((resolve) => {
                const coordinationListener = (event: MessageEvent) => {
                    if (event.data.type === 'acquire-pong') {
                        channel.removeEventListener('message', coordinationListener);
                        resolve(true);
                    }
                };
                channel.addEventListener('message', coordinationListener);
                channel.postMessage({ type: 'acquire-ping' });

                setTimeout(() => {
                    channel.removeEventListener('message', coordinationListener);
                    resolve(false);
                }, 100);
            });

            if (hasExistingSession) {
                throw new Error('WebGPU in use by another tab');
            }

            this.state = RegistryState.Initializing;
            const warmedSession = await this.warmupWithTimeout(this.WARMUP_TIMEOUT);
            this.ensureCoordinationResponder();
            return warmedSession;

        } finally {
            channel.close();
        }
    }

    private static ensureCoordinationResponder(): void {
        if (this.coordinationChannel) return;

        const channel = new BroadcastChannel(this.getChannelName());
        const listener = (event: MessageEvent) => {
            if (event.data?.type === 'acquire-ping' && this.session) {
                channel.postMessage({ type: 'acquire-pong' });
            }
        };

        channel.addEventListener('message', listener);
        this.coordinationChannel = channel;
        this.coordinationPingListener = listener;
    }

    private static releaseCoordinationLock(): void {
        this.webLockRelease?.();
        this.webLockRelease = null;

        if (this.coordinationChannel) {
            if (this.coordinationPingListener) {
                this.coordinationChannel.removeEventListener('message', this.coordinationPingListener);
            }
            this.coordinationChannel.close();
        }
        this.coordinationChannel = null;
        this.coordinationPingListener = null;
    }

    private static async warmupWithTimeout(ms: number): Promise<unknown> {
        const warmupPromise = this.activeWarmupPromise;
        if (warmupPromise) {
            logger.info('[WhisperRegistry] Reusing active model warmup instead of starting another download');
        } else {
            this.activeWarmupPromise = this.warmupEngine().finally(() => {
                this.activeWarmupPromise = null;
            });
        }

        const activeWarmup = this.activeWarmupPromise;
        if (!activeWarmup) {
            throw new Error('Whisper engine warmup failed to initialize.');
        }

        const slowLoadWarning = setTimeout(() => {
            logger.warn(
                { warningMs: this.WARMUP_SLOW_WARNING_MS, timeoutMs: ms },
                '[WhisperRegistry] Model setup is taking longer than expected; keeping the original warmup alive'
            );
        }, this.WARMUP_SLOW_WARNING_MS);

        if (typeof slowLoadWarning?.unref === 'function') {
            slowLoadWarning.unref();
        }

        let hardTimeout: NodeJS.Timeout | null = null;

        try {
            return await Promise.race([
                activeWarmup,
                new Promise<never>((_, reject) => {
                    hardTimeout = setTimeout(() => {
                        logger.error({ timeoutMs: ms }, '[WhisperRegistry] Model setup exceeded hard timeout');
                        reject(new Error(`Whisper engine initialization timed out after ${ms}ms.`));
                    }, ms);
                    if (typeof hardTimeout?.unref === 'function') {
                        hardTimeout.unref();
                    }
                }),
            ]);
        } finally {
            clearTimeout(slowLoadWarning);
            if (hardTimeout) clearTimeout(hardTimeout);
        }
    }

    private static async warmupEngine(): Promise<unknown> {
        logger.info('[WhisperRegistry] [PERF] First-time engine warmup starting...');
        const startTime = performance.now();

        if (!this.manager) {
            this.manager = new SessionManager();
            this.abortController = new AbortController();
        }

        const modelResult = await this.manager.loadModel(
            AvailableModels.WHISPER_TINY,
            () => logger.info('[WhisperRegistry] Model loaded.'),
            (progress) => {
                logger.debug({ progress }, '[WhisperRegistry] Loading...');
                this.progressListeners.forEach(cb => cb(progress));
            }
        );

        if (modelResult.isErr) throw modelResult.error;

        const duration = performance.now() - startTime;
        logger.info({ durationMs: duration.toFixed(2) }, '[WhisperRegistry] [PERF] Engine warmed up successfully');

        this.state = RegistryState.Available;
        this.startHeartbeat();
        return (modelResult as { value: unknown }).value;
    }

    private static startHeartbeat() {
        if (this.heartbeatInterval) return;
        this.heartbeatInterval = setInterval(() => {
            void (async () => {
                if (this.session) {
                    try {
                        const s = this.session as { transcribe?: (data: Float32Array) => Promise<unknown> };
                        await s.transcribe?.(new Float32Array(0));
                    } catch (e) {
                        logger.error({ error: e }, '[WhisperRegistry] Heartbeat failure. Purging engine.');
                        void this.purge();
                    }
                }
            })();
        }, 30000);

        // Ensure timer doesn't hang Node process in tests
        if (typeof this.heartbeatInterval?.unref === 'function') {
            this.heartbeatInterval.unref();
        }
    }

    private static stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    private static purgeTimeout: NodeJS.Timeout | null = null;
    private static GRACE_PERIOD_MS = 60000;

    public static release() {
        logger.info({ refCount: this.refCount, state: this.state }, '[WhisperRegistry] Releasing engine');

        if (this.state === RegistryState.Busy) {
            this.state = RegistryState.Available;
        }

        this.refCount = Math.max(0, this.refCount - 1);

        if (this.refCount === 0) {
            this.releaseCoordinationLock();

            if (this.purgeTimeout) clearTimeout(this.purgeTimeout);
            this.purgeTimeout = setTimeout(() => {
                if (this.refCount === 0) {
                    void this.purge();
                }
            }, this.GRACE_PERIOD_MS);

            if (typeof this.purgeTimeout?.unref === 'function') {
                this.purgeTimeout.unref();
            }
        }
    }

    public static async purge(): Promise<void> {
        logger.info('[WhisperRegistry] Purging engine and workers');

        const oldSession = this.session;
        const oldManager = this.manager;

        this.initPromise = null;
        this.activeWarmupPromise = null;
        this.session = null;
        this.manager = null;
        this.state = RegistryState.Destroyed;
        this.refCount = 0;
        this.stopHeartbeat();
        this.releaseCoordinationLock();

        if (this.purgeTimeout) {
            clearTimeout(this.purgeTimeout);
            this.purgeTimeout = null;
        }

        if (oldSession) {
            try {
                const s = oldSession as { destroy?: () => Promise<void> };
                await s.destroy?.();
            } catch (e) {
                logger.warn({ error: e }, '[WhisperRegistry] Error during session destruction');
            }
        }

        if (oldManager) {
            try {
                await (oldManager as unknown as { terminate?: () => Promise<void> }).terminate?.();
            } catch (e) {
                logger.warn({ error: e }, '[WhisperRegistry] Error terminating manager');
            }
        }
    }

    public static async reset(): Promise<void> {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        await this.purge();
        this.state = RegistryState.Idle;
        this.progressListeners.clear();
    }
}
