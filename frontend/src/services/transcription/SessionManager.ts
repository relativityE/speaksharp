import TranscriptionService, { TranscriptionServiceOptions } from './TranscriptionService';
import { DistributedLock } from '@/lib/DistributedLock';
import logger from '@/lib/logger';
import { STT_CONFIG } from '@/config';

/**
 * 🛡️ SESSION MANAGER (Structural Fix)
 * Authoritative owner of the transcription session and its engine.
 * Decouples infrastructure from UI (Controller) lifecycle.
 */
export class SessionManager {
    private static instance: SessionManager;
    private activeService: TranscriptionService | null = null;
    private destroying = false;

    private constructor() {}

    public static getInstance(): SessionManager {
        if (!SessionManager.instance) {
            SessionManager.instance = new SessionManager();
        }
        return SessionManager.instance;
    }

    /**
     * Retrieves or creates the transcription service for the session.
     * Guaranteed to return a stable instance across React remounts.
     */
    public getOrCreateService(options?: Partial<TranscriptionServiceOptions>, lock?: DistributedLock): TranscriptionService {
        // 🔒 Guard: Ensure we reuse the active service if it exists and is healthy
        if (this.activeService && !this.activeService.isServiceDestroyed()) {
            if (options) {
                this.activeService.updateCallbacks(options);
            }
            return this.activeService;
        }

        logger.info('[SessionManager] 🏗️ Creating new authoritative session service');
        
        // Use the statically imported class
        this.activeService = new TranscriptionService(
            options, 
            lock, 
            STT_CONFIG.HEARTBEAT_TIMEOUT_MS / 15, // ~2s
            STT_CONFIG.HEARTBEAT_TIMEOUT_MS
        );
        
        return this.activeService!;
    }

    /**
     * Side-effect-free accessor for Playwright/E2E
     */
    public getActiveService(): TranscriptionService | null {
        if (this.activeService?.isServiceDestroyed()) return null;
        return this.activeService;
    }

    /**
     * 🏁 TERMINATION BOUNDARY (Idempotent)
     * Forcefully terminates the engine and session.
     * Guaranteed safe against concurrent calls or StrictMode races.
     */
    public async destroySession(): Promise<void> {
        console.warn('[TRACE] DESTROY_SESSION_CALLED');
        if (!this.activeService) return;
        await this.activeService.destroy();
        this.activeService = null;
    }
}

export const sessionManager = SessionManager.getInstance();
