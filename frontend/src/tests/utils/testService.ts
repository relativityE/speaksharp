/**
 * Test Service Utility
 * 
 * Provides a helper to create TranscriptionService instances with guaranteed cleanup,
 * reducing the risk of hanging tests due to leaked resources/timers.
 */
import TranscriptionService, { TranscriptionServiceOptions } from '../../services/transcription/TranscriptionService';
import { PROD_FREE_POLICY } from '../../services/transcription/TranscriptionPolicy';

/**
 * Creates a TranscriptionService instance and registers it for cleanup.
 * 
 * @param options - Partial options to override defaults
 * @returns Object containing the service instance and a cleanup function
 */
export async function createTestService(
    options: Partial<TranscriptionServiceOptions> = {}
): Promise<{
    service: TranscriptionService;
    cleanup: () => Promise<void>;
}> {
    const fullOptions: Partial<TranscriptionServiceOptions> = {
        policy: PROD_FREE_POLICY,
        ...options
    };

    const service = new TranscriptionService(fullOptions);

    const cleanup = async () => {
        if (!service.isServiceDestroyed()) {
            try {
                // Use a timeout to ensure cleanup doesn't hang the test runner
                await Promise.race([
                    service.destroy(),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Service destroy timeout in test util')), 5000)
                    )
                ]);
            } catch (error) {
                // console.error('[createTestService] Cleanup failed:', error);
                // Swallow error to allow other tests to run
            }
        }
    };

    return { service, cleanup };
}
