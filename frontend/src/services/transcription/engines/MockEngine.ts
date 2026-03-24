import { Result } from '../modes/types';
import { EngineCallbacks, EngineType } from '@/contracts/IPrivateSTTEngine';

import logger from '@/lib/logger';
import { STTEngine } from '@/contracts/STTEngine';
import { TranscriptionModeOptions } from '../modes/types';

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

    constructor(_options?: TranscriptionModeOptions) {
        super();
    }

    /**
     * IPrivateSTTEngine implementation via STTEngine hooks
     */
    protected async onInit(callbacks: EngineCallbacks): Promise<Result<void, Error>> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[MockEngine] Initializing...');

        if (callbacks.onModelLoadProgress) {
            callbacks.onModelLoadProgress(0);
            await new Promise(r => setTimeout(r, 100)); // Simulate minimal load time
            callbacks.onModelLoadProgress(100);
        }

        if (callbacks.onReady) {
            callbacks.onReady();
        }

        return { isOk: true, data: undefined };
    }

    protected async onStart(): Promise<void> {
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

    /**
     * Legacy Interface compatibility (to satisfy ITranscriptionEngine)
     */
    public override async init(callbacks: EngineCallbacks, timeoutMs?: number): Promise<Result<void, Error>>;
    public async init(): Promise<void>;
    public override async init(callbacks?: EngineCallbacks, timeoutMs?: number): Promise<Result<void, Error> | void> {
        if (callbacks && typeof callbacks === 'object' && 'onReady' in callbacks) {
            return super.init(callbacks, timeoutMs);
        }
        this.isInitialized = true;
    }

    async startTranscription(_mic?: unknown): Promise<void> {
        await this.start();
    }

    async stopTranscription(): Promise<string> {
        await this.stop();
        return `[MOCK] Final transcript for ${this.serviceId}`;
    }

    dispose(): void {
        void this.destroy();
    }

    async getTranscript(): Promise<string> {
        return `[MOCK] Current transcript for ${this.serviceId}`;
    }

    getEngineType(): string {
        return this.type;
    }

    async pause(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId }, '[MockEngine] Pause requested');
    }

    async resume(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId }, '[MockEngine] Resume requested');
    }

    async terminate(): Promise<void> {
        await this.destroy();
    }
}
