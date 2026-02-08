/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TransformersJSEngine } from '../TransformersJSEngine';
import fs from 'fs';
import path from 'path';

/**
 * HIGH FIDELITY INTEGRATION TEST
 * This test verifies that the TransformersJS engine can actually transcribe
 * real PCM data from a WAV file. This runs in Node/Vitest but uses the
 * EXACT same engine code as the browser.
 */
describe('TransformersJSEngine (Integration - Real Audio)', () => {
    let engine: TransformersJSEngine;

    beforeEach(() => {
        // Enable debug logging for this test
        (globalThis as unknown as { __E2E_CONTEXT__: boolean }).__E2E_CONTEXT__ = true;
        engine = new TransformersJSEngine();
    });

    it('should transcribe test_speech_16k.wav correctly', async () => {
        // 1. Read the audio file
        const fixturePath = path.resolve(process.cwd(), '../tests/fixtures/test_speech_16k.wav');
        console.log(`[IntegrationTest] Reading fixture from: ${fixturePath}`);

        if (!fs.existsSync(fixturePath)) {
            throw new Error(`Fixture not found at ${fixturePath}`);
        }

        const buffer = fs.readFileSync(fixturePath);

        // 2. Simple WAV decoding (Skipping 44-byte header for standard PCM WAV)
        const headerSize = 44;
        const pcmDataInt16 = new Int16Array(
            buffer.buffer,
            buffer.byteOffset + headerSize,
            (buffer.length - headerSize) / 2
        );

        // 3. Convert to Float32 [-1.0, 1.0] as expected by TransformersJS
        const float32Data = new Float32Array(pcmDataInt16.length);
        for (let i = 0; i < pcmDataInt16.length; i++) {
            float32Data[i] = pcmDataInt16[i] / 32768.0;
        }

        console.log(`[IntegrationTest] Processed ${float32Data.length} samples (${(float32Data.length / 16000).toFixed(2)}s)`);

        // 4. Initialize engine
        const initResult = await engine.init({
            onModelLoadProgress: (p) => {
                if (p % 25 === 0) console.log(`[IntegrationTest] Model loading: ${p}%`);
            }
        });

        expect(initResult.isOk, `Init failed: ${initResult.isErr ? initResult.error.message : 'Unknown'}`).toBe(true);

        // 5. Transcribe
        console.log('[IntegrationTest] Starting transcription...');
        const startTime = Date.now();
        const result = await engine.transcribe(float32Data);
        const duration = Date.now() - startTime;

        console.log(`[IntegrationTest] Transcription took ${duration}ms`);

        // 6. Assert result
        expect(result.isOk).toBe(true);
        const text = result.isOk ? result.value : '';
        console.log(`[IntegrationTest] Transcript: "${text}"`);

        // Check for key words from the generated speech
        const lowerText = text.toLowerCase();
        expect(lowerText).toMatch(/testing|audio|transcription|speech/);
    }, 60000); // 60s timeout for model download/inference
});
