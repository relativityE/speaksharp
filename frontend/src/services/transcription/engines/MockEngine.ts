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
    private currentState: string = 'IDLE';

    constructor(_options?: TranscriptionModeOptions) {
        super(_options);
    }

    private setState(state: string): void {
        this.currentState = state;
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

    protected async onInit(_timeoutMs?: number): Promise<Result<void, Error>> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[MockEngine] Initializing...');
        
        // 1. Immediately signal DOWNLOADING — UI must render download button from this
        this.setState('DOWNLOADING');

        const callbacks = this.options as TranscriptionModeOptions;
        if (callbacks.onModelLoadProgress) {
            callbacks.onModelLoadProgress(0);
        }

        // 2. Wait for UI/Test to subscribe before completing
        await this.waitForSubscriber();

        if (callbacks.onModelLoadProgress) {
            callbacks.onModelLoadProgress(100);
        }

        // 3. Finalize initialization
        if (callbacks.onConnectionStateChange) {
            callbacks.onConnectionStateChange('connected'); // Triggers setEngineReady(true)
        }
        if (callbacks.onReady) {
            callbacks.onReady();
        }

        this.setState('READY');

        // HANDSHAKE v3: Bridge to Playwright poll
        const readyStateWin = window as unknown as { __APP_READY_STATE__?: Record<string, boolean> };
        if (typeof window !== 'undefined' && readyStateWin.__APP_READY_STATE__) {
            readyStateWin.__APP_READY_STATE__['model-ready'] = true;
            readyStateWin.__APP_READY_STATE__['stt'] = true;
        }

        return { isOk: true, data: undefined };
    }

    protected async onStart(_mic?: MicStream): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[MockEngine] Start Hook called.');
    }

    protected async onStop(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[MockEngine] Stop Hook called.');
    }

    protected async onDestroy(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[MockEngine] Destroy Hook called.');
    }

    async transcribe(_audio: Float32Array): Promise<Result<string, Error>> {
        if (!this.isInitialized) {
            return { isOk: false, error: new Error('MockEngine not initialized.') };
        }

        this.updateHeartbeat();

        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[MockEngine] Transcribing dummy audio block...');
        
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

    protected async onPause(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId }, '[MockEngine] onPause hook called');
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
