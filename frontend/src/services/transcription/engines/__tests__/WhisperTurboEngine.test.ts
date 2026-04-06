import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WhisperTurboEngine } from '../WhisperTurboEngine';
import type { EngineCallbacks } from '@/contracts/IPrivateSTTEngine';
import { setupStrictZero } from '../../../../../../tests/setupStrictZero';

/**
 * ARCHITECTURE:
 * WhisperTurboEngine tests must bypass CI WASM guards at T=0
 * via the authorized engineType: 'real' manifest injection.
 */

// Mock the Registry AT THE TOP to block whisper-webgpu resolution
vi.mock('../WhisperEngineRegistry', () => ({
    WhisperEngineRegistry: {
        acquire: vi.fn(),
        release: vi.fn(),
        purge: vi.fn()
    }
}));

describe('WhisperTurboEngine (Fast Path)', () => {
    let WhisperTurboEngineClass: typeof WhisperTurboEngine;
    let ENV: { isTest: boolean; disableWasm: boolean };
    let engine: WhisperTurboEngine;

    const mocks = {
        transcribe: vi.fn(),
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        
        // Final Architectural Directive: Authoritative T=0 Identity Injection
        await setupStrictZero({ engineType: 'real' });

        // Dynamic Import AFTER T=0 setup
        const flagsModule = await import('../../../../config/TestFlags');
        ENV = flagsModule.ENV;

        const { WhisperEngineRegistry } = await import('../WhisperEngineRegistry');

        const engineModule = await import('../WhisperTurboEngine');
        WhisperTurboEngineClass = engineModule.WhisperTurboEngine;

        engine = new WhisperTurboEngineClass();

        vi.mocked(WhisperEngineRegistry.acquire).mockResolvedValue({
            transcribe: mocks.transcribe
        } as unknown as { transcribe: (...args: unknown[]) => Promise<unknown> });
    });

    afterEach(async () => {
        if (engine) {
            await engine.terminate();
        }
        if (typeof window !== 'undefined') {
            const win = window as unknown as Record<string, unknown>;
            delete win.__SS_E2E__;
        }
    });

    it('should have correct engine type', () => {
        // T=0 Compliance Check
        expect(ENV.isTest).toBe(true);
        expect(ENV.disableWasm).toBe(false); // Bypassed for authorized engine test

        expect(engine.type).toBe('whisper-turbo');
    });

    it('should initialize successfully via registry', async () => {
        const onProgress = vi.fn();
        const onReady = vi.fn();

        const result = await engine.init({
            onModelLoadProgress: onProgress,
            onReady: onReady
        });

        expect(result.isOk).toBe(true);
        const { WhisperEngineRegistry } = await import('../WhisperEngineRegistry');
        expect(WhisperEngineRegistry.acquire).toHaveBeenCalled();
        expect(onReady).toHaveBeenCalled();
    });

    it('should transcribe audio correctly', async () => {
        mocks.transcribe.mockResolvedValueOnce({
            isOk: true,
            data: { text: 'Transcribed text' }
        });

        await engine.init({} as unknown as EngineCallbacks);
        const result = await engine.transcribe(new Float32Array([0.1]));

        expect(result.isOk).toBe(true);
        expect((result as unknown as { data: string }).data).toBe('Transcribed text');
    });
});
