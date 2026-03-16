import TranscriptionService, { TranscriptionServiceOptions } from './TranscriptionService';
import logger from '@/lib/logger';

/**
 * ARCHITECTURE (Senior Architect):
 * STTServiceFactory enables the "Disposable Service" pattern.
 * It yields the "Universal Orchestrator" (TranscriptionService).
 * 
 * TYPES HANDLED BY CREATED SERVICE:
 * - 'private': Whisper WASM (On-device)
 * - 'cloud': AssemblyAI (Server-side)
 * - 'native': Browser Web Speech API
 * 
 * Instead of a global singleton, each session or test context requests a fresh service.
 * This guarantees 100% isolation and prevents state pollution in CI environments.
 */
export class STTServiceFactory {
  /**
   * Creates a new instance of the Universal Transcription Orchestrator.
   * The specific STT type (private/cloud/native) is determined by the policy 
   * passed in the options.
   */
  public static createService(options: Partial<TranscriptionServiceOptions> = {}): TranscriptionService {
    const service = new TranscriptionService(options);
    
    // Track the lifecycle in the global window for E2E visibility, 
    // but the controller remains the authoritative owner of the instance.
    if (typeof window !== 'undefined') {
      window.__TRANSCRIPTION_SERVICE__ = service;
    }

    logger.info({ 
      serviceId: service.getSessionId() || 'unbound',
      action: 'SERVICE_CREATED'
    }, '[STTServiceFactory] Yielding fresh TranscriptionService instance');

    return service;
  }
}
