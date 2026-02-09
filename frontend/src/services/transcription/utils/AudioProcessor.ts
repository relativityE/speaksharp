/**
 * AudioProcessor - Shared audio conversion utilities for STT modes.
 *
 * This module extracts common audio processing patterns used by:
 * - CloudAssemblyAI (Float32 → Int16)
 * - OnDeviceWhisper (Float32 → WAV)
 *
 * Centralizing these utilities reduces code duplication and ensures
 * consistent audio handling across all transcription modes.
 */

/**
 * Convert Float32Array audio samples to Int16Array.
 * Used by CloudAssemblyAI for WebSocket streaming.
 *
 * @param float32Array - Audio samples in Float32 format (-1.0 to 1.0)
 * @returns Int16Array suitable for WebSocket transmission
 */
export function floatToInt16(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        int16Array[i] = Math.max(-32768, Math.min(32767, float32Array[i] * 32767));
    }
    return int16Array;
}

/**
 * Convert Float32Array audio samples to WAV-formatted Uint8Array.
 * Used by OnDeviceWhisper for inference.
 *
 * @param samples - Audio samples in Float32 format
 * @param sampleRate - Sample rate (default: 16000 Hz for Whisper)
 * @returns WAV file as Uint8Array
 */
export function floatToWav(samples: Float32Array, sampleRate = 16000): Uint8Array {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');

    // fmt sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
    view.setUint16(22, 1, true);  // NumChannels (1 for mono)
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, sampleRate * 2, true); // ByteRate
    view.setUint16(32, 2, true);  // BlockAlign
    view.setUint16(34, 16, true); // BitsPerSample

    // data sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);

    // Write samples (convert Float32 to Int16)
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
    }

    return new Uint8Array(buffer);
}

/**
 * Write a string to a DataView at the specified offset.
 * Helper for WAV header generation.
 */
function writeString(view: DataView, offset: number, string: string): void {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

/**
 * Concatenate multiple Float32Arrays into a single array.
 * Used for accumulating audio chunks before processing.
 *
 * @param arrays - Array of Float32Arrays to concatenate
 * @returns Single concatenated Float32Array
 */
export function concatenateFloat32Arrays(arrays: Float32Array[]): Float32Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

/**
 * Audio buffer manager for accumulating samples until a minimum threshold.
 * Used by CloudAssemblyAI for buffering before WebSocket send.
 */
export class AudioBuffer {
    private buffer: Int16Array = new Int16Array(0);

    constructor(private readonly minSamples: number = 800) { } // 50ms at 16kHz

    /**
     * Add samples to buffer, returns data if minimum threshold reached.
     * @returns Int16Array to send, or null if still accumulating
     */
    addSamples(samples: Int16Array): Int16Array | null {
        const newBuffer = new Int16Array(this.buffer.length + samples.length);
        newBuffer.set(this.buffer);
        newBuffer.set(samples, this.buffer.length);
        this.buffer = newBuffer;

        if (this.buffer.length >= this.minSamples) {
            const data = this.buffer;
            this.buffer = new Int16Array(0);
            return data;
        }
        return null;
    }

    /**
     * Flush any remaining buffered samples.
     */
    flush(): Int16Array {
        const data = this.buffer;
        this.buffer = new Int16Array(0);
        return data;
    }

    /**
     * Clear the buffer without returning data.
     */
    clear(): void {
        this.buffer = new Int16Array(0);
    }
}

/**
 * Downsample audio from an input sample rate to a target sample rate.
 * Uses linear interpolation for simple and efficient resampling.
 * 
 * @param audio - Input audio samples
 * @param inputSampleRate - Source sample rate (e.g., 44100, 48000)
 * @param targetSampleRate - Target sample rate (e.g., 16000)
 * @returns Downsampled Float32Array
 */
export function downsampleAudio(audio: Float32Array, inputSampleRate: number, targetSampleRate: number = 16000): Float32Array {
    if (inputSampleRate === targetSampleRate) {
        return audio;
    }

    if (inputSampleRate < targetSampleRate) {
        throw new Error('Upsampling is not supported');
    }

    const ratio = inputSampleRate / targetSampleRate;
    const newLength = Math.floor(audio.length / ratio);
    const result = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
        // Linear interpolation
        const position = i * ratio;
        const index = Math.floor(position);
        const decimal = position - index;

        // Simple check to avoid out of bounds
        const p0 = audio[index] || 0;
        const p1 = audio[index + 1] || p0;

        result[i] = p0 + decimal * (p1 - p0);
    }

    return result;
}

/**
 * ASYNC AUDIO PROCESSING VIA WEB WORKER
 * -------------------------------------
 * Offloads heavy audio processing to a background thread to keep UI smooth.
 */

import { AudioWorkerResponse } from './audio-processor.worker';

let audioWorker: Worker | null = null;
let workerRequestId = 0;

function generateCorrelationId(): string {
    return `req-${++workerRequestId}-${Date.now()}`;
}

function getWorker(): Worker {
    if (!audioWorker) {
        // Vite syntax for workers
        audioWorker = new Worker(new URL('./audio-processor.worker.ts', import.meta.url), { type: 'module' });
    }
    return audioWorker;
}

/**
 * Asynchronously downsamples audio in a background worker.
 */
export async function downsampleAudioAsync(audio: Float32Array, inputRate: number, targetRate: number = 16000): Promise<Float32Array> {
    const worker = getWorker();
    const correlationId = generateCorrelationId();

    return new Promise((resolve, reject) => {
        const handler = (event: MessageEvent<AudioWorkerResponse>) => {
            const data = event.data;
            // Only handle responses for THIS request
            if (data.correlationId !== correlationId) return;

            if (data.type === 'DOWNSAMPLE_RESULT') {
                worker.removeEventListener('message', handler);
                resolve(data.result);
            } else if (data.type === 'ERROR') {
                worker.removeEventListener('message', handler);
                reject(new Error(data.message));
            }
        };
        worker.addEventListener('message', handler);
        worker.postMessage({ type: 'DOWNSAMPLE', correlationId, audio, inputRate, targetRate }, [audio.buffer]);
    });
}

/**
 * Asynchronously converts Float32 to WAV in a background worker.
 */
export async function floatToWavAsync(samples: Float32Array, sampleRate: number = 16000): Promise<Uint8Array> {
    const worker = getWorker();
    const correlationId = generateCorrelationId();

    return new Promise((resolve, reject) => {
        const handler = (event: MessageEvent<AudioWorkerResponse>) => {
            const data = event.data;
            // Only handle responses for THIS request
            if (data.correlationId !== correlationId) return;

            if (data.type === 'FLOAT_TO_WAV_RESULT') {
                worker.removeEventListener('message', handler);
                resolve(data.result);
            } else if (data.type === 'ERROR') {
                worker.removeEventListener('message', handler);
                reject(new Error(data.message));
            }
        };
        worker.addEventListener('message', handler);
        worker.postMessage({ type: 'FLOAT_TO_WAV', correlationId, samples, sampleRate }, [samples.buffer]);
    });
}

/**
 * Asynchronously converts Float32 to Int16 in a background worker.
 * Returns both the raw Int16Array and a Base64-encoded string for convenience.
 */
export async function floatToInt16Async(float32Array: Float32Array): Promise<{ result: Int16Array, base64: string }> {
    const worker = getWorker();
    const correlationId = generateCorrelationId();

    return new Promise((resolve, reject) => {
        const handler = (event: MessageEvent<AudioWorkerResponse>) => {
            const data = event.data;
            // Only handle responses for THIS request
            if (data.correlationId !== correlationId) return;

            if (data.type === 'FLOAT_TO_INT16_RESULT') {
                worker.removeEventListener('message', handler);
                resolve({ result: data.result, base64: data.base64 || '' });
            } else if (data.type === 'ERROR') {
                worker.removeEventListener('message', handler);
                reject(new Error(data.message));
            }
        };
        worker.addEventListener('message', handler);
        worker.postMessage({ type: 'FLOAT_TO_INT16', correlationId, float32Array }, [float32Array.buffer]);
    });
}
