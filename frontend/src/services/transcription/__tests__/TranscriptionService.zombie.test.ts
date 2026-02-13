
/**
 * @file TranscriptionService.zombie.test.ts
 * @description Verification test for zombie instance prevention in TranscriptionService
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TranscriptionService, { TranscriptionServiceOptions } from '../TranscriptionService';
import PrivateWhisper from '../modes/PrivateWhisper';
import CloudAssemblyAI from '../modes/CloudAssemblyAI';
import { ITranscriptionMode } from '../modes/types';

// Mock dependencies
vi.mock('../modes/PrivateWhisper');
vi.mock('../modes/CloudAssemblyAI');
vi.mock('../utils/AudioProcessor');
vi.mock('../../../lib/logger');

// Helper to create a mock mode instance
function createMockMode(): ITranscriptionMode {
    return {
        init: vi.fn().mockResolvedValue(undefined),
        startTranscription: vi.fn(),
        stopTranscription: vi.fn().mockResolvedValue(''),
        getTranscript: vi.fn().mockResolvedValue(''),
        terminate: vi.fn().mockResolvedValue(undefined),
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
        vi.mocked(PrivateWhisper).mockImplementation(() => createMockMode() as unknown as PrivateWhisper);
        vi.mocked(CloudAssemblyAI).mockImplementation(() => createMockMode() as unknown as CloudAssemblyAI);
    });

    it('should terminate old instance before switching modes', async () => {
        // 1. Initialize Cloud mode directly (accessing exposed protected method)
        await service.triggerExecuteMode('cloud', mockOptions);

        const mockCloudInstance = createMockMode();
        vi.mocked(CloudAssemblyAI).mockImplementation(() => mockCloudInstance as unknown as CloudAssemblyAI);

        // Re-run to use our tracked instance
        await service.triggerExecuteMode('cloud', mockOptions);

        // 2. Initialize Private mode (this should trigger terminate on cloud instance)
        await service.triggerExecuteMode('private', mockOptions);

        // ASSERT: Cloud instance terminate must be called
        expect(mockCloudInstance.terminate).toHaveBeenCalled();
    });

    it('should handle concurrent terminate calls gracefully', async () => {
        const mockInstance = createMockMode();
        vi.mocked(CloudAssemblyAI).mockImplementation(() => mockInstance as unknown as CloudAssemblyAI);

        await service.triggerExecuteMode('cloud', mockOptions);

        // Simulate rapid destroy calls
        const p1 = service.destroy();
        const p2 = service.destroy();

        await expect(Promise.all([p1, p2])).resolves.not.toThrow();

        // Should only terminate once effectively
        expect(mockInstance.terminate).toHaveBeenCalledTimes(1);
    });
});
