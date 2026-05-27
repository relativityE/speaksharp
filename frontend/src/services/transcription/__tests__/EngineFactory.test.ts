import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EngineFactory } from '../EngineFactory';
import NativeBrowser from '../modes/NativeBrowser';
import CloudAssemblyAI from '../modes/CloudAssemblyAI';
import { PROD_FREE_POLICY, TranscriptionMode } from '../TranscriptionPolicy';
import { TranscriptionModeOptions } from '../modes/types';
import { NavigateFunction } from 'react-router-dom';
import { STT_MODE_PROVIDER_CONFIG } from '../providers/sttProviderConfig';

const privateWhisperMock = vi.hoisted(() => vi.fn());

// Mock dependencies
vi.mock('../modes/NativeBrowser');
vi.mock('../modes/CloudAssemblyAI');
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
        (STT_MODE_PROVIDER_CONFIG.native as { defaultProvider: string }).defaultProvider = 'auto-browser';
        (STT_MODE_PROVIDER_CONFIG.private as { defaultProvider: string }).defaultProvider = 'transformers-js';
        (STT_MODE_PROVIDER_CONFIG.cloud as { defaultProvider: string }).defaultProvider = 'assemblyai';
        if (typeof window !== 'undefined') {
            const win = window as unknown as Record<string, unknown>;
            win.__SS_E2E__ = undefined;
        }
    });

    describe('create', () => {
        it('should create NativeBrowser for native mode', async () => {
            // Act
            await EngineFactory.create('native', mockConfig, PROD_FREE_POLICY);
            expect(NativeBrowser).toHaveBeenCalledWith(mockConfig);
        });

        it('should create CloudAssemblyAI for cloud mode', async () => {
            await EngineFactory.create('cloud', mockConfig, PROD_FREE_POLICY);
            expect(CloudAssemblyAI).toHaveBeenCalledWith(mockConfig);
        });

        it('should throw error for unsupported mode', async () => {
            // Cast to TranscriptionMode to test runtime validation
            const unsupportedMode = 'unknown' as TranscriptionMode;
            await expect(EngineFactory.create(unsupportedMode, mockConfig, PROD_FREE_POLICY)).rejects.toThrow('Unsupported transcription mode');
        });

        it('should fail loudly when config selects an unavailable cloud provider', async () => {
            (STT_MODE_PROVIDER_CONFIG.cloud as { defaultProvider: string }).defaultProvider = 'deepgram';

            await expect(EngineFactory.create('cloud', mockConfig, PROD_FREE_POLICY)).rejects.toThrow('Provider "deepgram" for mode "cloud" is not available');
            expect(CloudAssemblyAI).not.toHaveBeenCalled();
        });

        it('matrix: constructs every implemented native provider without provider-routing errors', async () => {
            const implementedNativeProviders = STT_MODE_PROVIDER_CONFIG.native.providers
                .filter((provider) => 'registryKey' in provider && provider.registryKey === 'native-browser')
                .map((provider) => provider.id);

            for (const provider of implementedNativeProviders) {
                vi.clearAllMocks();
                (STT_MODE_PROVIDER_CONFIG.native as { defaultProvider: string }).defaultProvider = provider;

                await expect(EngineFactory.create('native', mockConfig, PROD_FREE_POLICY)).resolves.toBeDefined();
                expect(NativeBrowser).toHaveBeenCalledWith(mockConfig);
            }
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

        it('matrix: constructs implemented cloud providers', async () => {
            const implementedCloudProviders = STT_MODE_PROVIDER_CONFIG.cloud.providers
                .filter((provider) => 'registryKey' in provider && provider.registryKey === 'assemblyai');

            for (const provider of implementedCloudProviders) {
                vi.clearAllMocks();
                (STT_MODE_PROVIDER_CONFIG.cloud as { defaultProvider: string }).defaultProvider = provider.id;

                await expect(EngineFactory.create('cloud', mockConfig, PROD_FREE_POLICY)).resolves.toBeDefined();
                expect(CloudAssemblyAI).toHaveBeenCalledWith(mockConfig);
            }
        });

        it('matrix: rejects unavailable cloud providers', async () => {
            const unavailableCloudProviders = STT_MODE_PROVIDER_CONFIG.cloud.providers
                .filter((provider) => !('registryKey' in provider));

            for (const provider of unavailableCloudProviders) {
                vi.clearAllMocks();
                (STT_MODE_PROVIDER_CONFIG.cloud as { defaultProvider: string }).defaultProvider = provider.id;

                await expect(EngineFactory.create('cloud', mockConfig, PROD_FREE_POLICY)).rejects.toThrow(`Provider "${provider.id}" for mode "cloud" is not available`);
                expect(CloudAssemblyAI).not.toHaveBeenCalled();
            }
        });

        it('matrix: rejects explicitly unavailable native providers', async () => {
            (STT_MODE_PROVIDER_CONFIG.native as { defaultProvider: string }).defaultProvider = 'unsupported';

            await expect(EngineFactory.create('native', mockConfig, PROD_FREE_POLICY)).rejects.toThrow('Provider "unsupported" for mode "native" is not available');
            expect(NativeBrowser).not.toHaveBeenCalled();
        });
    });
});
