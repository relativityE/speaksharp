
/**
 * @file TranscriptionService.zombie.test.ts
 * @description Verification test for zombie instance prevention in TranscriptionService
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TranscriptionService, { TranscriptionServiceOptions } from '../TranscriptionService';
import PrivateWhisper from '../modes/PrivateWhisper';
import CloudAssemblyAI from '../modes/CloudAssemblyAI';
import NativeBrowser from '../modes/NativeBrowser';
import { ITranscriptionMode } from '../modes/types';

// Mock dependencies
vi.mock('../modes/PrivateWhisper');
vi.mock('../modes/CloudAssemblyAI');
vi.mock('../modes/NativeBrowser');
vi.mock('../utils/AudioProcessor');
vi.mock('../../../lib/logger');

// Helper to create a mock mode instance
function createMockMode(name: string): ITranscriptionMode {
    return {
        init: vi.fn().mockName(`${name}.init`).mockResolvedValue(undefined),
        startTranscription: vi.fn().mockName(`${name}.startTranscription`),
        stopTranscription: vi.fn().mockName(`${name}.stopTranscription`).mockResolvedValue(''),
        getTranscript: vi.fn().mockName(`${name}.getTranscript`).mockResolvedValue(''),
        terminate: vi.fn().mockName(`${name}.terminate`).mockResolvedValue(undefined),
        getEngineType: vi.fn().mockName(`${name}.getEngineType`).mockReturnValue(name),
    };
}

// Testable subclass to expose protected methods
class TestTranscriptionService extends TranscriptionService {
    public async triggerExecuteMode(mode: string, config: TranscriptionServiceOptions) {
        return (this as unknown as { executeMode: (m: string, c: TranscriptionServiceOptions) => Promise<void> }).executeMode(mode, config);
    }
}

describe('Zombie Instance Prevention', () => {
    let service: TestTranscriptionService;

    // Create a robust mock for options
    const mockOptions: TranscriptionServiceOptions = {
        onTranscriptUpdate: vi.fn(),
        onModelLoadProgress: vi.fn(),
        onReady: vi.fn(),
        session: null,
        navigate: vi.fn(),
        getAssemblyAIToken: vi.fn().mockResolvedValue('mock-token'),
        onModeChange: vi.fn(),
        onStatusChange: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        service = new TestTranscriptionService(mockOptions);

        // Setup mock constructors
        vi.mocked(PrivateWhisper).mockImplementation((_options) => createMockMode('private') as unknown as PrivateWhisper);
        vi.mocked(CloudAssemblyAI).mockImplementation((_options) => createMockMode('cloud') as unknown as CloudAssemblyAI);
    });

    it('should terminate old instance before switching modes', async () => {
        const mockCloudInstance = createMockMode('cloud-instance-1');
        vi.mocked(CloudAssemblyAI).mockImplementationOnce(() => mockCloudInstance as unknown as CloudAssemblyAI);

        // 1. Initialize Cloud mode
        await service.triggerExecuteMode('cloud', mockOptions);

        const mockPrivateInstance = createMockMode('private-instance-1');
        vi.mocked(PrivateWhisper).mockImplementationOnce(() => mockPrivateInstance as unknown as PrivateWhisper);

        // 2. Initialize Private mode (this should trigger terminate on cloud instance)
        await service.triggerExecuteMode('private', mockOptions);

        // ASSERT: Cloud instance terminate must be called
        await vi.waitFor(() => {
            expect(mockCloudInstance.terminate).toHaveBeenCalled();
        }, { timeout: 1000 });
    });

    it('should handle concurrent terminate calls gracefully', async () => {
        const mockCloudInstance = createMockMode('concurrent-terminate-cloud');
        const mockNativeInstance = createMockMode('concurrent-terminate-native');

        vi.mocked(CloudAssemblyAI).mockImplementation(() => mockCloudInstance as unknown as CloudAssemblyAI);
        vi.mocked(NativeBrowser).mockImplementation(() => mockNativeInstance as unknown as NativeBrowser);

        await service.triggerExecuteMode('cloud', mockOptions);

        // Simulate rapid destroy calls
        const p1 = service.destroy();
        const p2 = service.destroy();

        await expect(Promise.all([p1, p2])).resolves.not.toThrow();

        // Should only terminate once effectively
        await vi.waitFor(() => {
            expect(mockCloudInstance.terminate).toHaveBeenCalledTimes(1);
        });
    });
});
