/// <reference lib="webworker" />

/**
 * Web Worker for heavy audio processing tasks.
 * Offloads CPU-bound operations from the main thread to prevent UI jank.
 */

// Define message types - correlationId prevents race conditions with concurrent requests
export type AudioWorkerMessage =
    | { type: 'DOWNSAMPLE', correlationId: string, audio: Float32Array, inputRate: number, targetRate: number }
    | { type: 'FLOAT_TO_WAV', correlationId: string, samples: Float32Array, sampleRate: number }
    | { type: 'FLOAT_TO_INT16', correlationId: string, float32Array: Float32Array };

export type AudioWorkerResponse =
    | { type: 'DOWNSAMPLE_RESULT', correlationId: string, result: Float32Array }
    | { type: 'FLOAT_TO_WAV_RESULT', correlationId: string, result: Uint8Array }
    | { type: 'FLOAT_TO_INT16_RESULT', correlationId: string, result: Int16Array, base64?: string }
    | { type: 'ERROR', correlationId: string, message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<AudioWorkerMessage>) => {
    const data = event.data;
    const correlationId = data.correlationId;

    try {
        switch (data.type) {
            case 'DOWNSAMPLE': {
                const result = downsampleAudio(data.audio, data.inputRate, data.targetRate);
                ctx.postMessage({ type: 'DOWNSAMPLE_RESULT', correlationId, result }, [result.buffer]);
                break;
            }
            case 'FLOAT_TO_WAV': {
                const result = floatToWav(data.samples, data.sampleRate);
                ctx.postMessage({ type: 'FLOAT_TO_WAV_RESULT', correlationId, result }, [result.buffer]);
                break;
            }
            case 'FLOAT_TO_INT16': {
                const result = floatToInt16(data.float32Array);

                // Also perform Base64 conversion here to offload the main thread
                // Use array join instead of O(n) concatenation for performance
                const bytes = new Uint8Array(result.buffer);
                const len = bytes.byteLength;
                const charCodes = new Array(len);
                for (let i = 0; i < len; i++) {
                    charCodes[i] = String.fromCharCode(bytes[i]);
                }
                const base64 = btoa(charCodes.join(''));

                ctx.postMessage({ type: 'FLOAT_TO_INT16_RESULT', correlationId, result, base64 }, [result.buffer]);
                break;
            }
        }
    } catch (err) {
        ctx.postMessage({ type: 'ERROR', correlationId, message: (err as Error).message });
    }
};

// Copy logic from AudioProcessor.ts (since we can't easily import from Main thread files in some worker setups)
// In a real Vite setup, worker imports work, but let's be self-contained for robustness.

export function floatToInt16(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        int16Array[i] = Math.max(-32768, Math.min(32767, float32Array[i] * 32767));
    }
    return int16Array;
}

export function writeString(view: DataView, offset: number, string: string): void {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

export function floatToWav(samples: Float32Array, sampleRate = 16000): Uint8Array {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
    }
    return new Uint8Array(buffer);
}

export function downsampleAudio(audio: Float32Array, inputSampleRate: number, targetSampleRate: number = 16000): Float32Array {
    if (inputSampleRate === targetSampleRate) return audio;
    const ratio = inputSampleRate / targetSampleRate;
    const newLength = Math.floor(audio.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
        const position = i * ratio;
        const index = Math.floor(position);
        const decimal = position - index;
        const p0 = audio[index] || 0;
        const p1 = audio[index + 1] || p0;
        result[i] = p0 + decimal * (p1 - p0);
    }
    return result;
}
