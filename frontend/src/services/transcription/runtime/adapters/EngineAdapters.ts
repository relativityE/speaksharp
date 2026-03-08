import { IEngineAdapter, EngineType } from '../types';
import { MicStream } from '../../utils/types';
import { TranscriptionModeOptions, ITranscriptionMode } from '../../modes/types';
import PrivateWhisper from '../../modes/PrivateWhisper';
import NativeBrowser from '../../modes/NativeBrowser';
import CloudAssemblyAI from '../../modes/CloudAssemblyAI';

/**
 * Base class for Engine Adapters to reduce boilerplate
 */
abstract class BaseEngineAdapter implements IEngineAdapter {
    abstract readonly type: EngineType;
    protected engine: ITranscriptionMode | null = null;
    protected transcript: string = '';

    constructor(protected options: TranscriptionModeOptions) {}

    async initialize(): Promise<void> {
        if (!this.engine) {
            this.engine = this.createEngine();
        }
        await this.engine.init();
    }

    async start(mic: MicStream): Promise<void> {
        if (!this.engine) throw new Error(`${this.type} engine not initialized`);
        this.transcript = '';
        await this.engine.startTranscription(mic);
    }

    async stop(): Promise<string> {
        if (!this.engine) return '';
        this.transcript = await this.engine.stopTranscription();
        return this.transcript;
    }

    async dispose(): Promise<void> {
        if (this.engine?.terminate) {
            await this.engine.terminate();
        }
        this.engine = null;
    }

    getTranscript(): string {
        return this.transcript;
    }

    protected abstract createEngine(): ITranscriptionMode;
}

/**
 * Private Engine Adapter
 */
export class PrivateEngineAdapter extends BaseEngineAdapter {
    readonly type: EngineType = 'private';

    protected createEngine(): ITranscriptionMode {
        return new PrivateWhisper(this.options);
    }
}

/**
 * Native Engine Adapter
 */
export class NativeEngineAdapter extends BaseEngineAdapter {
    readonly type: EngineType = 'native';

    protected createEngine(): ITranscriptionMode {
        return new NativeBrowser(this.options);
    }

    // Native doesn't strictly need mic for start but ITranscriptionMode.startTranscription takes it
    async start(mic: MicStream): Promise<void> {
        this.transcript = '';
        await this.engine?.startTranscription(mic);
    }
}

/**
 * Cloud Engine Adapter
 */
export class CloudEngineAdapter extends BaseEngineAdapter {
    readonly type: EngineType = 'cloud';

    protected createEngine(): ITranscriptionMode {
        return new CloudAssemblyAI(this.options);
    }

    async start(mic: MicStream): Promise<void> {
        await super.start(mic);

        // Bridge audio from MicStream to CloudAssemblyAI.processAudio
        mic.onFrame((frame) => {
            if (this.engine && 'processAudio' in this.engine) {
                (this.engine as { processAudio: (data: Float32Array) => void }).processAudio(frame);
            }
        });
    }
}
