import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { SpeechRuntimeConfig } from '../types';
import { ModelLifecycleManager } from '../ModelLifecycleManager';
import { PROD_PRO_POLICY } from '../../TranscriptionPolicy';
import { TranscriptionModeOptions } from '../../modes/types';

// Mock dependencies at the lowest level possible to test BEHAVIOR of the controller/adapters
vi.mock('../../utils/audioUtils', () => ({
    createMicStream: vi.fn().mockResolvedValue({
        stop: vi.fn(),
        onFrame: vi.fn().mockReturnValue(() => { })
    })
}));

// We use real adapters but mock the underlying engines they wrap
vi.mock('../../modes/PrivateWhisper', () => {
    return {
        default: vi.fn().mockImplementation(() => ({
            init: vi.fn().mockResolvedValue(undefined),
            startTranscription: vi.fn().mockResolvedValue(undefined),
            stopTranscription: vi.fn().mockResolvedValue('private transcript'),
            terminate: vi.fn().mockResolvedValue(undefined),
            getEngineType: vi.fn().mockReturnValue('private')
        }))
    };
});

vi.mock('../../modes/NativeBrowser', () => {
    return {
        default: vi.fn().mockImplementation(() => ({
            init: vi.fn().mockResolvedValue(undefined),
            startTranscription: vi.fn().mockResolvedValue(undefined),
            stopTranscription: vi.fn().mockResolvedValue('native transcript'),
            getEngineType: vi.fn().mockReturnValue('native')
        }))
    };
});

vi.mock('../../modes/CloudAssemblyAI', () => {
    return {
        default: vi.fn().mockImplementation(() => ({
            init: vi.fn().mockResolvedValue(undefined),
            startTranscription: vi.fn().mockResolvedValue(undefined),
            stopTranscription: vi.fn().mockResolvedValue('cloud transcript'),
            getEngineType: vi.fn().mockReturnValue('cloud')
        }))
    };
});

describe('Speech Runtime Behavioral Integration', () => {
    let config: SpeechRuntimeConfig;
    let options: TranscriptionModeOptions;

    beforeEach(() => {
        vi.clearAllMocks();
        config = {
            onStateChange: vi.fn(),
            onStatusChange: vi.fn(),
            onTranscriptUpdate: vi.fn(),
            onEvent: vi.fn()
        };
        options = {
            onTranscriptUpdate: vi.fn(),
            onReady: vi.fn()
        };
    });

    it('should coordinate full lifecycle from start to stop using real adapters', async () => {
        const modelManager = ModelLifecycleManager.getInstance();
        vi.spyOn(modelManager, 'isModelCached').mockResolvedValue(true);

        const controller = new SpeechRuntimeController(config, PROD_PRO_POLICY, options);

        // 1. Start - should initialize private engine (preferred in PRO policy)
        await controller.start();
        expect(controller.getState()).toBe('RECORDING');

        // 2. Verify events
        expect(config.onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'engine_activated', mode: 'private' }));

        // 3. Stop
        const transcript = await controller.stop();
        expect(transcript).toBe('private transcript');
        expect(controller.getState()).toBe('READY');
    });

    it('should handle background download and auto-switch behaviorally', async () => {
        const modelManager = ModelLifecycleManager.getInstance();
        vi.spyOn(modelManager, 'isModelCached').mockResolvedValue(false);

        let resolveLoad: () => void;
        const loadPromise = new Promise<void>(resolve => { resolveLoad = resolve; });
        vi.spyOn(modelManager, 'loadModel').mockReturnValue(loadPromise);

        const controller = new SpeechRuntimeController(config, PROD_PRO_POLICY, options);

        // 1. Start - should fallback to native immediately
        await controller.start();
        expect(config.onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'engine_fallback', to: 'native' }));

        // 2. Finish download
        resolveLoad!();
        await loadPromise;

        // Wait for auto-switch
        await new Promise(resolve => setTimeout(resolve, 50));

        // 3. Verify auto-switch event
        expect(config.onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'engine_activated', mode: 'private' }));

        // 4. Stop - should return private transcript now
        const transcript = await controller.stop();
        expect(transcript).toBe('private transcript');
    });

    it('should enforce privacy: never send audio to cloud when private mode is active', async () => {
        const privatePolicy = { ...PROD_PRO_POLICY, preferredMode: 'private' as const, allowCloud: false };
        const controller = new SpeechRuntimeController(config, privatePolicy, options);

        const modelManager = ModelLifecycleManager.getInstance();
        vi.spyOn(modelManager, 'isModelCached').mockResolvedValue(true);

        await controller.start();

        // Explicitly check that no cloud related classes were even instantiated
        const CloudAssemblyAI = (await import('../../modes/CloudAssemblyAI')).default;
        expect(CloudAssemblyAI).not.toHaveBeenCalled();
    });
});
