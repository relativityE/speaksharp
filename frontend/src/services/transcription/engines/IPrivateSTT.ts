import { Result } from 'true-myth';
import { EngineType, EngineCallbacks } from './IPrivateSTTEngine';

export interface PrivateSTTInitOptions extends EngineCallbacks {
    forceEngine?: EngineType;
}

export interface IPrivateSTT {
    init(options: PrivateSTTInitOptions): Promise<Result<EngineType, Error>>;
    transcribe(audio: Float32Array): Promise<Result<string, Error>>;
    destroy(): Promise<void>;
    getEngineType(): EngineType | null;
}
