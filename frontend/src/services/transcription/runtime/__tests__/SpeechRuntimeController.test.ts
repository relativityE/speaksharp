import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { SpeechRuntimeConfig } from '../types';
import { ModelLifecycleManager } from '../ModelLifecycleManager';
import { PROD_PRO_POLICY } from '../../TranscriptionPolicy';
import { TranscriptionModeOptions } from '../../modes/types';

// Mock dependencies
vi.mock('../../utils/audioUtils', () => ({
    createMicStream: vi.fn().mockResolvedValue({
        stop: vi.fn(),
        onFrame: vi.fn().mockReturnValue(() => { })
    })
}));

vi.mock('../adapters/EngineAdapters', () => {
    const MockPrivateAdapter = vi.fn().mockImplementation(() => ({
        type: 'private',
        initialize: vi.fn().mockResolvedValue(undefined),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue('test transcript'),
        dispose: vi.fn().mockResolvedValue(undefined),
        getTranscript: vi.fn().mockReturnValue('test transcript')
    }));

    const MockNativeAdapter = vi.fn().mockImplementation(() => ({
        type: 'native',
        initialize: vi.fn().mockResolvedValue(undefined),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue('test transcript'),
        dispose: vi.fn().mockResolvedValue(undefined),
        getTranscript: vi.fn().mockReturnValue('test transcript')
    }));

    const MockCloudAdapter = vi.fn().mockImplementation(() => ({
        type: 'cloud',
        initialize: vi.fn().mockResolvedValue(undefined),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue('test transcript'),
        dispose: vi.fn().mockResolvedValue(undefined),
        getTranscript: vi.fn().mockReturnValue('test transcript')
    }));

    return {
        PrivateEngineAdapter: MockPrivateAdapter,
        NativeEngineAdapter: MockNativeAdapter,
        CloudEngineAdapter: MockCloudAdapter
    };
});

vi.mock('../ModelLifecycleManager', () => {
    const mockManager = {
        isModelCached: vi.fn().mockResolvedValue(true),
        loadModel: vi.fn().mockResolvedValue(undefined),
        warmUp: vi.fn().mockResolvedValue(undefined),
        getLoadingProgress: vi.fn().mockReturnValue(100)
    };
    return {
        ModelLifecycleManager: {
            getInstance: vi.fn().mockReturnValue(mockManager)
        }
    };
});

describe('SpeechRuntimeController', () => {
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

    it('should initialize to UNINITIALIZED state', () => {
        const controller = new SpeechRuntimeController(config, PROD_PRO_POLICY, options);
        expect(controller.getState()).toBe('UNINITIALIZED');
        expect(config.onStateChange).toHaveBeenCalledWith('UNINITIALIZED');
    });

    it('should transition through states during start', async () => {
        const controller = new SpeechRuntimeController(config, PROD_PRO_POLICY, options);
        await controller.start();

        // Check if it reached RECORDING state (or at least READY)
        expect(['READY', 'RECORDING']).toContain(controller.getState());
    });

    it('should handle stop correctly', async () => {
        const controller = new SpeechRuntimeController(config, PROD_PRO_POLICY, options);
        await controller.start();
        await controller.stop();
        expect(controller.getState()).toBe('READY');
    });

    it('should auto-switch to private when model is ready', async () => {
        const modelManager = ModelLifecycleManager.getInstance();
        vi.spyOn(modelManager, 'isModelCached').mockImplementation(async (mode) => mode !== 'private');

        // Mock loadModel to resolve after a delay
        let resolveLoad: () => void;
        const loadPromise = new Promise<void>(resolve => { resolveLoad = resolve; });
        vi.spyOn(modelManager, 'loadModel').mockReturnValue(loadPromise);

        const controller = new SpeechRuntimeController(config, PROD_PRO_POLICY, options);

        // Start runtime - should fallback to native
        await controller.start();
        expect(controller.getState()).toBe('RECORDING');
        // config.onEvent should have been called with engine_fallback to native
        expect(config.onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'engine_fallback', to: 'native' }));

        // Finish model loading
        resolveLoad!();
        await loadPromise;

        // Wait for microtasks (auto-switch is async)
        await new Promise(resolve => setTimeout(resolve, 100));

        // Should have switched to private
        expect(config.onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'engine_activated', mode: 'private' }));
    });

    it('should maintain privacy: never send audio to cloud if private mode requested', async () => {
        const privatePolicy = { ...PROD_PRO_POLICY, preferredMode: 'private' as const, allowCloud: false };
        const controller = new SpeechRuntimeController(config, privatePolicy, options);

        await controller.start();

        // Ensure cloud adapter was never created/started
        const { CloudEngineAdapter } = await import('../adapters/EngineAdapters');
        expect(CloudEngineAdapter).not.toHaveBeenCalled();
    });

    it('should handle terminate correctly', async () => {
        const controller = new SpeechRuntimeController(config, PROD_PRO_POLICY, options);
        await controller.start();
        await controller.terminate();
        expect(controller.getState()).toBe('UNINITIALIZED');
    });
});
