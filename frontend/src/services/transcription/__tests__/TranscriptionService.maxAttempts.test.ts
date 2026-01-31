import TranscriptionService from '../TranscriptionService';
import { TranscriptionPolicy } from '../TranscriptionPolicy';
import { TranscriptionModeOptions, ITranscriptionMode } from '../modes/types';

// Mock dependencies
vi.mock('../../lib/logger', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('../utils/audioUtils', () => ({
    createMicStream: vi.fn().mockResolvedValue({
        stop: vi.fn(),
        onFrame: vi.fn(),
    }),
}));

// Mock NativeBrowser mode
const mockNativeInit = vi.fn().mockResolvedValue(undefined);
const mockNativeStart = vi.fn().mockResolvedValue(undefined);
vi.mock('../modes/NativeBrowser', () => ({
    default: class MockNativeBrowser {
        init = mockNativeInit;
        startTranscription = mockNativeStart;
        stopTranscription = vi.fn();
    },
}));

describe('TranscriptionService - Max Attempts', () => {
    let service: TranscriptionService;
    const onStatusChange = vi.fn();

    // Mock implementations for window injection
    const mockPrivateInit = vi.fn();
    const mockPrivateStart = vi.fn();

    class MockPrivateWhisper {
        init = mockPrivateInit;
        startTranscription = mockPrivateStart;
        stopTranscription = vi.fn();
        constructor(_config: unknown) { }
    }

    const privatePolicy: TranscriptionPolicy = {
        executionIntent: 'quality',
        allowNative: true,
        allowCloud: false,
        allowPrivate: true,
        preferredMode: 'private',
        allowFallback: true,
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        // Reset via public static helper
        TranscriptionService.resetFailureCount();

        // Inject mock into window (simulating E2E/Test environment)
        window.MockPrivateWhisper = MockPrivateWhisper as unknown as new (config: TranscriptionModeOptions) => ITranscriptionMode;
        window.__E2E_MOCK_LOCAL_WHISPER__ = true;

        service = new TranscriptionService({
            onTranscriptUpdate: vi.fn(),
            onModelLoadProgress: vi.fn(),
            onReady: vi.fn(),
            onStatusChange,
            navigate: vi.fn(),
            getAssemblyAIToken: vi.fn(),
            session: null,
            policy: privatePolicy,
        });

        await service.init();
    });

    afterEach(() => {
        // Cleanup window pollution
        window.MockPrivateWhisper = undefined;
        window.__E2E_MOCK_LOCAL_WHISPER__ = undefined;
    });

    it('should enforce Native fallback after max private attempts', async () => {
        // 1. First Attempt - Fails
        mockPrivateInit.mockRejectedValueOnce(new Error('Init Failed 1'));

        try {
            await service.startTranscription();
        } catch (e) { /* ignore fallback errors */ }

        expect(mockPrivateInit).toHaveBeenCalledTimes(1);
        expect(mockNativeInit).toHaveBeenCalledTimes(1); // Standard fallback
        // Behavior check confirms logic without peeking

        await service.stopTranscription();

        // Reset mocks
        mockPrivateInit.mockClear();
        mockNativeInit.mockClear();
        onStatusChange.mockClear();

        // 2. Second Attempt - Fails
        mockPrivateInit.mockRejectedValueOnce(new Error('Init Failed 2'));
        try {
            await service.startTranscription();
        } catch (e) { /* ignore fallback errors */ }

        expect(mockPrivateInit).toHaveBeenCalledTimes(1);
        // Behavior check

        await service.stopTranscription();

        // Reset mocks
        mockPrivateInit.mockClear();
        mockNativeInit.mockClear();
        onStatusChange.mockClear();

        // 3. Third Attempt - Should NOT try Private, should Force Native
        await service.startTranscription();

        // EXPECTATIONS
        expect(mockPrivateInit).not.toHaveBeenCalled(); // Should be skipped

        expect(mockNativeInit).toHaveBeenCalledTimes(1); // Should call Native directly

        expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({
            type: 'fallback',
            message: expect.stringContaining('Too many failures'),
            newMode: 'native'
        }));
    });
});
