import TranscriptionService, { TranscriptionServiceOptions } from './TranscriptionService';
import logger from '../../lib/logger';
import { ENV } from '../../config/TestFlags';
import { STT_CONFIG } from '@/config';

/**
 * ARCHITECTURE:
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
    // 🚀 Narrow Mic Bypass (CI/E2E)
    // We inject a mock mic handle if one isn't provided, allowing the service 
    // to complete its initialization FSM without physical hardware.
    const isE2E = ENV.isE2E;
    const isCI = typeof process !== 'undefined' && (process.env.CI === 'true' || process.env.E2E === 'true');

    if ((isE2E || isCI) && !options.mockMic) {
      options.mockMic = {
        state: 'ready',
        sampleRate: 16000,
        onFrame: () => () => { },
        offFrame: () => { },
        stop: () => { },
        close: () => { },
        _mediaStream: new MediaStream()
      };
      logger.info('[STTServiceFactory] 🎤 Injecting narrow Mic bypass for CI/E2E environment');
    }

    const service = new TranscriptionService(
      options,
      undefined,
      STT_CONFIG.HEARTBEAT_TIMEOUT_MS / 15, // default ~2s
      STT_CONFIG.HEARTBEAT_TIMEOUT_MS
    );
    
    // Track the lifecycle in the global window for E2E visibility, 
    // but the controller remains the authoritative owner of the instance.
    if (typeof window !== 'undefined') {
      window.__TRANSCRIPTION_SERVICE_INTERNAL__ = service;
    }

    logger.info({ 
      serviceId: service.getSessionId() || 'unbound',
      action: 'SERVICE_CREATED'
    }, '[STTServiceFactory] Yielding fresh TranscriptionService instance');

    return service;
  }
}
