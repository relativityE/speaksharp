
import { Result } from 'true-myth';

export class SessionManager {
    async loadModel(model: string, onSuccess: () => void, onProgress: (p: number) => void) {
        onSuccess();
        onProgress(100);
        return Result.ok(new InferenceSession());
    }
}

export class InferenceSession {
    async transcribe(audio: Uint8Array, dtw: boolean, options: any) {
        return Result.ok({ text: "Mock transcription" });
    }
}

export const AvailableModels = {
    WHISPER_TINY: "whisper-tiny-en",
    WHISPER_BASE: "whisper-base-en",
};

export default { SessionManager, InferenceSession, AvailableModels };
