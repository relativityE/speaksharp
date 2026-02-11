/**
 * ============================================================================
 * MOCK ENGINE FOR CI/E2E TESTS
 * ============================================================================
 * 
 * Provides a stable mock implementation for Private STT in CI environments.
 * Both whisper-turbo and transformers.js fail in headless Playwright due to
 * WASM/ONNX runtime limitations.
 * 
 * This mock:
 * - Simulates model loading with progress
 * - Returns predefined transcription results
 * - Ensures E2E tests can verify the full UI flow
 * 
 * @see docs/ARCHITECTURE.md - "Dual-Engine Private STT"
 */

import { Result } from 'true-myth';
import { IPrivateSTTEngine, EngineCallbacks, EngineType } from './IPrivateSTTEngine';
import logger from '../../../lib/logger';

export class MockEngine implements IPrivateSTTEngine {
    public readonly type: EngineType = 'mock';

    async init(callbacks: EngineCallbacks, _timeoutMs?: number): Promise<Result<void, Error>> {
        logger.info('[MockEngine] 🎭 Initializing mock engine for CI/E2E testing...');

        // 1. Check for E2E Hang override (allows testing persistent loading states)
        const win = window as unknown as { __E2E_HANG_INIT__?: boolean; __E2E_RELEASE_INIT__?: (v: void) => void };
        if (typeof window !== 'undefined' && win.__E2E_HANG_INIT__) {
            logger.info('[MockEngine] ⏳ E2E Hang requested. Waiting for __E2E_RELEASE_INIT__...');
            await new Promise<void>(resolve => {
                win.__E2E_RELEASE_INIT__ = resolve;
            });
            logger.info('[MockEngine] 🔓 E2E Release received.');
        }

        // Simulate loading progress
        if (callbacks.onModelLoadProgress) {
            callbacks.onModelLoadProgress(0);
            await new Promise(r => setTimeout(r, 100));
            callbacks.onModelLoadProgress(50);
            await new Promise(r => setTimeout(r, 100));
            callbacks.onModelLoadProgress(100);
        }

        if (callbacks.onReady) {
            callbacks.onReady();
        }

        logger.info('[MockEngine] Mock engine initialized successfully.');
        return Result.ok(undefined);
    }

    async transcribe(_audio: Float32Array): Promise<Result<string, Error>> {
        // Return simulated transcription
        const mockText = 'This is a mock transcription for testing purposes.';
        return Result.ok(mockText);
    }

    async destroy(): Promise<void> {
        logger.info('[MockEngine] Mock engine destroyed.');
    }
}
