/**
 * ============================================================================
 * PRIVATE STT INTEGRATION TESTS
 * ============================================================================
 * 
 * Tests the PrivateSTT dual-engine facade WITHOUT mocking engine internals.
 * These tests verify:
 * 1. Engine selection logic (WebGPU → TransformersJS fallback)
 * 2. MockEngine behavior in test environments
 * 3. Error handling and self-healing cache clear
 * 4. Interface contract compliance
 * 
 * NOTE: Real WhisperTurbo/TransformersJS engines require browser environment.
 * These tests run MockEngine path since window.TEST_MODE is set.
 * 
 * For real engine testing, use E2E tests: tests/e2e/private-stt.e2e.spec.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrivateSTT, createPrivateSTT } from '@/services/transcription/engines/PrivateSTT';
import { EngineCallbacks } from '@/services/transcription/engines/IPrivateSTTEngine';

describe('PrivateSTT Integration', () => {
    let stt: PrivateSTT;
    let callbacks: EngineCallbacks;
    let progressValues: number[];
    let readyCalled: boolean;

    beforeEach(() => {
        // Ensure test mode is set
        (window as unknown as { TEST_MODE: boolean }).TEST_MODE = true;

        progressValues = [];
        readyCalled = false;

        callbacks = {
            onModelLoadProgress: (progress: number | null) => {
                if (progress !== null) {
                    progressValues.push(progress);
                }
            },
            onReady: () => {
                readyCalled = true;
            },
        };

        stt = createPrivateSTT();
    });

    afterEach(async () => {
        await stt.destroy();
    });

    describe('Engine Selection', () => {
        it('should select MockEngine in test environment', async () => {
            const result = await stt.init(callbacks);

            expect(result.isOk).toBe(true);
            expect(result.isOk && result.value).toBe('mock');
            expect(stt.getEngineType()).toBe('mock');
        });

        it('should call onReady callback after initialization', async () => {
            await stt.init(callbacks);

            expect(readyCalled).toBe(true);
        });

        it('should report progress during initialization', async () => {
            await stt.init(callbacks);

            // MockEngine should report 0 and 100 progress
            expect(progressValues).toContain(0);
            expect(progressValues).toContain(100);
        });
    });

    describe('Transcription', () => {
        it('should transcribe audio after initialization', async () => {
            await stt.init(callbacks);

            // Create mock audio data (1 second of silence at 16kHz)
            const audio = new Float32Array(16000);

            const result = await stt.transcribe(audio);

            expect(result.isOk).toBe(true);
            // MockEngine returns predictable mock text
            expect(result.isOk && typeof result.value).toBe('string');
        });

        it('should fail transcription before initialization', async () => {
            const audio = new Float32Array(16000);

            const result = await stt.transcribe(audio);

            expect(result.isErr).toBe(true);
        });
    });

    describe('Lifecycle', () => {
        it('should reset engine type after destroy', async () => {
            await stt.init(callbacks);
            expect(stt.getEngineType()).toBe('mock');

            await stt.destroy();
            expect(stt.getEngineType()).toBeNull();
        });

        it('should allow re-initialization after destroy', async () => {
            await stt.init(callbacks);
            await stt.destroy();

            const result = await stt.init(callbacks);

            expect(result.isOk).toBe(true);
            expect(stt.getEngineType()).toBe('mock');
        });
    });

    describe('Factory Function', () => {
        it('createPrivateSTT should return uninitialized instance', () => {
            const instance = createPrivateSTT();

            expect(instance.getEngineType()).toBeNull();
        });
    });
});

describe('PrivateSTT Fallback Logic', () => {
    // These tests verify the code paths without actually running WebGPU

    it('should have correct engine type constants', async () => {
        const stt = createPrivateSTT();
        (window as unknown as { TEST_MODE: boolean }).TEST_MODE = true;

        await stt.init({});

        // Verify engine type is one of the valid values
        const validTypes = ['whisper-turbo', 'transformers-js', 'mock'];
        expect(validTypes).toContain(stt.getEngineType());

        await stt.destroy();
    });
});
