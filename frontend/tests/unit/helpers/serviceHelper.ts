import { vi } from 'vitest';
import type { TranscriptionServiceOptions } from '@/services/transcription/TranscriptionService';
import type { TranscriptionPolicy } from '@/services/transcription/TranscriptionPolicy';
import { PROD_FREE_POLICY } from '@/services/transcription/TranscriptionPolicy';

/**
 * Industry Pattern: Lazy Service Initialization
 * Pattern: Used by Google, Facebook test suites to prevent Mock Poisoning.
 */

export async function createTestTranscriptionService(
    overrides?: Partial<TranscriptionServiceOptions>
) {
    // ✅ Dynamic import - only loads when called, ensuring mocks are applied
    const { default: TranscriptionService } = await import(
        '@/services/transcription/TranscriptionService'
    );

    const defaultOptions: TranscriptionServiceOptions = {
        onTranscriptUpdate: vi.fn(),
        onModelLoadProgress: vi.fn(),
        onReady: vi.fn(),
        session: null,
        navigate: vi.fn() as any,
        getAssemblyAIToken: vi.fn().mockResolvedValue('test-token'),
        policy: PROD_FREE_POLICY,
        ...overrides
    };

    return new TranscriptionService(defaultOptions);
}

export async function cleanupTranscriptionService(
    service: any | null
) {
    if (service && typeof service.destroy === 'function') {
        await service.destroy();
    }
}
