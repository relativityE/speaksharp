import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTranscriptionService, type UseTranscriptionServiceOptions } from '../useTranscriptionService';
import TranscriptionService from '../../../services/transcription/TranscriptionService';

// Mock TranscriptionService
vi.mock('../../../services/transcription/TranscriptionService', () => {
    return {
        default: vi.fn().mockImplementation(() => ({
            init: vi.fn().mockResolvedValue({ success: true }),
            startTranscription: vi.fn().mockResolvedValue(undefined),
            stopTranscription: vi.fn().mockResolvedValue({ success: true }),
            destroy: vi.fn().mockResolvedValue(undefined),
            getMode: vi.fn().mockReturnValue('native'),
        })),
    };
});

// Mock toast to avoid alias resolution issues
vi.mock('@/lib/toast', () => ({
    toast: {
        success: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
    },
}));

// Mock logger
vi.mock('../../../lib/logger', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
    },
}));

describe('useTranscriptionService - Immutable Callback Capture', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should always call the latest callback version without recreating the service', async () => {
        // 1. Setup initial callbacks
        const initialCallback = vi.fn();
        const latestCallback = vi.fn();

        const { result, rerender } = renderHook(
            (props: UseTranscriptionServiceOptions) => useTranscriptionService(props),
            {
                initialProps: {
                    onTranscriptUpdate: initialCallback,
                    onModelLoadProgress: vi.fn(),
                    onReady: vi.fn(),
                    session: null,
                    navigate: vi.fn(),
                    getAssemblyAIToken: vi.fn(),
                },
            }
        );

        // 2. Start listening to initialize the service
        await act(async () => {
            // @ts-expect-error - testing invalid engine
            await result.current.startListening({ executionIntent: 'test' });
        });

        // Verify service instantiated once
        expect(TranscriptionService).toHaveBeenCalledTimes(1);

        // Capture the options passed to the constructor
        const capturedOptions = (TranscriptionService as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];

        // 3. Update the hook with a NEW callback
        rerender({
            onTranscriptUpdate: latestCallback, // <--- New callback
            onModelLoadProgress: vi.fn(),
            onReady: vi.fn(),
            session: null,
            navigate: vi.fn(),
            getAssemblyAIToken: vi.fn(),
        });

        // Verify service was NOT recreated (crucial for performance/state stability)
        expect(TranscriptionService).toHaveBeenCalledTimes(1);

        // 4. Simulate a service event invoking the callback stored in the service
        // The service holds the 'wrappedOptions' from creation time
        capturedOptions.onTranscriptUpdate({ transcript: { final: 'test' } });

        // 5. Verification
        // The OLD callback should NOT be called
        expect(initialCallback).not.toHaveBeenCalled();

        // The NEW callback SHOULD be called (via the proxy)
        expect(latestCallback).toHaveBeenCalled();
    });
});
