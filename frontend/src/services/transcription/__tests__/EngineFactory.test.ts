import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EngineFactory } from '../EngineFactory';
import { PROD_FREE_POLICY, TranscriptionMode } from '../TranscriptionPolicy';
import { TranscriptionModeOptions } from '../modes/types';
import { NavigateFunction } from 'react-router-dom';
import { STT_MODE_PROVIDER_CONFIG } from '../providers/sttProviderConfig';

const privateWhisperMock = vi.hoisted(() => vi.fn());

// Mock dependencies. #1320: Native/Web-Speech is retired — Private is the only production engine.
vi.mock('../modes/PrivateWhisper', () => ({
    default: privateWhisperMock,
}));
vi.mock('../engines/PrivateSTT', () => {
    const mockEngine = {
        checkAvailability: vi.fn().mockResolvedValue({ available: true }),
        init: vi.fn().mockResolvedValue({ isOk: true }),
        getEngineType: () => 'private',
        type: 'private'
    };
    return {
        PrivateSTT: vi.fn().mockImplementation(() => mockEngine)
    };
});

describe('EngineFactory', () => {
    // Correct TranscriptionModeOptions for type safety
    const mockConfig: TranscriptionModeOptions = {
        onTranscriptUpdate: vi.fn(),
        onModelLoadProgress: vi.fn(),
        onReady: vi.fn(),
        session: null,
        navigate: vi.fn() as unknown as NavigateFunction,
        getAssemblyAIToken: vi.fn().mockResolvedValue('token')
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (STT_MODE_PROVIDER_CONFIG.private as { defaultProvider: string }).defaultProvider = 'transformers-js';
        if (typeof window !== 'undefined') {
            const win = window as unknown as Record<string, unknown>;
            win.__SS_E2E__ = undefined;
        }
    });

    describe('create', () => {
        it('should throw error for unsupported mode', async () => {
            // Cast to TranscriptionMode to test runtime validation
            const unsupportedMode = 'unknown' as TranscriptionMode;
            await expect(EngineFactory.create(unsupportedMode, mockConfig, PROD_FREE_POLICY)).rejects.toThrow('Unsupported transcription mode');
        });


        it('matrix: constructs every implemented private provider selected by config', async () => {
            for (const provider of STT_MODE_PROVIDER_CONFIG.private.providers) {
                vi.clearAllMocks();
                (STT_MODE_PROVIDER_CONFIG.private as { defaultProvider: string }).defaultProvider = provider.id;

                await expect(EngineFactory.create('private', mockConfig, PROD_FREE_POLICY)).resolves.toBeDefined();
                expect(privateWhisperMock).toHaveBeenCalledWith({
                    ...mockConfig,
                    forceEngine: provider.id,
                });
            }
        });



    });
});
