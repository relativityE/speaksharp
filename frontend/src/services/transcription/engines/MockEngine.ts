import { Result, TranscriptionModeOptions } from '../modes/types';
import { EngineType } from '../../../contracts/IPrivateSTTEngine';

import logger from '../../../lib/logger';
import { STTEngine } from '../../../contracts/STTEngine';
import type { AvailabilityResult } from '../STTStrategy';
import type { MicStream } from '../utils/types';

/**
 * Industry Standard: Deterministic Mock Pattern
 * 
 * DESIGN RATIONALE:
 * This mock is essential for E2E stability. It provides:
 * 1. Monotonic timing (no flaky network waits).
 * 2. Predictable transcripts via correlation IDs.
 * 3. Heartbeat simulation to satisfy the STTEngine contract.
 */
export class MockEngine extends STTEngine {
    public readonly type: EngineType = 'mock';
    private isDestroyed = false;
    private engineInstanceId: string = Math.random().toString(36).slice(2);

    constructor(_options?: TranscriptionModeOptions) {
        super(_options);
    }

    private setState(_state: string): void {
        // NOTE: Forensic signaling (data-runtime-state) is now handled 
        // centrally by TranscriptionProvider via the store subscription.
    }

    private async waitForSubscriber(timeoutMs: number = 5000): Promise<void> {
        if (typeof window === 'undefined') return;
        
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const win = window as unknown as { __SUBSCRIBER_READY__?: boolean; TEST_MODE?: boolean };
            if (win.__SUBSCRIBER_READY__ || win.TEST_MODE) {
                logger.debug('[MockEngine] Subscriber handshake received');
                return;
            }
            await new Promise(r => setTimeout(r, 50));
        }
        logger.warn('[MockEngine] Subscriber handshake timeout - proceeding anyway');
    }

    public async checkAvailability(): Promise<AvailabilityResult> {
        return { isAvailable: true, message: 'Mock engine always available' };
    }

    protected override async onInit(): Promise<Result<void, Error>> {
        const callbacks = this.options as TranscriptionModeOptions;
        if (callbacks.onConnectionStateChange && !this.isDestroyed) {
            callbacks.onConnectionStateChange('connected');
        }
        if (callbacks.onReady && !this.isDestroyed) {
            callbacks.onReady();
        }
        return Result.ok(undefined);
    }

    private lastReceivedUserWords: string[] = [];

    protected override async onStart(_mic?: MicStream, userWords: string[] = []): Promise<void> {
        this.lastReceivedUserWords = userWords;
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, engineId: this.engineInstanceId, userWords }, '[MockEngine] Start Hook called.');
    }

    protected async onStop(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, engineId: this.engineInstanceId }, '[MockEngine] Stop Hook called.');
    }

    async destroy(): Promise<void> {
        this.isDestroyed = true; // ← must be first
        await super.destroy();
    }

    protected async onDestroy(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, engineId: this.engineInstanceId }, '[MockEngine] Destroy Hook called.');
    }

    async transcribe(_audio: Float32Array): Promise<Result<string, Error>> {
        if (!this.isInitialized) {
            return { isOk: false, error: new Error('MockEngine not initialized.') };
        }

        this.updateHeartbeat();

        logger.info({ sId: this.serviceId, rId: this.runId }, '[MockEngine] Transcribing dummy audio block...');
        
        // Return a deterministic transcript based on serviceId for test validation
        const transcript = `[MOCK] Translated segment for ${this.serviceId}`;
        
        this.updateHeartbeat();
        return { isOk: true, data: transcript };
    }

    async getTranscript(): Promise<string> {
        return `[MOCK] Current transcript for ${this.serviceId}`;
    }

    getEngineType(): string {
        return this.type;
    }

    public async pause(): Promise<void> {
        await super.pause();
    }

    public async resume(): Promise<void> {
        await super.resume();
    }

    protected async onResume(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId }, '[MockEngine] onResume hook called');
    }

    async terminate(): Promise<void> {
        await this.destroy();
    }
}
