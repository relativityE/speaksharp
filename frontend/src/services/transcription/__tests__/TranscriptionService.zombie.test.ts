
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
    public getInstance() { return this.instance; }
    public getState() { return this.state; }
    public getIsTerminating() { return this.isTerminating; }
    public async triggerExecuteMode(mode: string, config: TranscriptionServiceOptions) {
        return (this as unknown as { executeMode: (m: string, c: TranscriptionServiceOptions) => Promise<void> }).executeMode(mode, config);
    }
}

describe('TranscriptionService - Zombie Prevention', () => {
    let service: TestTranscriptionService;

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
        vi.mocked(NativeBrowser).mockImplementation((_options) => createMockMode('native') as unknown as NativeBrowser);
    });

    it('should terminate old instance before switching modes (Behavior-based)', async () => {
        // 1. Initialize Cloud mode
        await service.triggerExecuteMode('cloud', mockOptions);
        expect(service.getInstance()).toBeDefined();
        expect(service.getState()).toBe('RECORDING');

        // 2. Initialize Private mode (should trigger terminate on cloud)
        await service.triggerExecuteMode('private', mockOptions);

        // ASSERT BEHAVIOR: Instance should now be the private one
        expect(service.getInstance()?.getEngineType()).toBe('private');
    });

    it('should handle concurrent terminate calls gracefully (Behavior-based)', async () => {
        await service.triggerExecuteMode('cloud', mockOptions);
        expect(service.getInstance()).toBeDefined();

        // RAPID DESTROY CALLS
        const p1 = service.destroy();
        const p2 = service.destroy();
        const p3 = service.destroy();

        const results = await Promise.allSettled([p1, p2, p3]);

        // ✅ TEST BEHAVIOR: All calls should fulfill
        results.forEach(result => {
            expect(result.status).toBe('fulfilled');
        });

        // ✅ TEST STATE: Service should be IDLE and instance nulled
        expect(service.getState()).toBe('IDLE');
        expect(service.getInstance()).toBeNull();
        expect(service.getIsTerminating()).toBe(false); // Lock released
    });

    it('should be idempotent: additional destroy calls are safe', async () => {
        await service.triggerExecuteMode('cloud', mockOptions);
        await service.destroy();

        expect(service.getInstance()).toBeNull();
        expect(service.getState()).toBe('IDLE');

        // Call again
        await expect(service.destroy()).resolves.not.toThrow();
        expect(service.getInstance()).toBeNull();
    });
});
