import { MicStream } from './utils/types';

/**
 * ARCHITECTURE: STTStrategy
 * This interface defines the mandatory contract for all Speech-to-Text strategies.
 * It ensures that the TranscriptionService can orchestrate any mode (Private, Cloud, Native)
 * without knowing its internal implementation details.
 */

export interface AvailabilityResult {
  isAvailable: boolean;
  reason?: 'CACHE_MISS' | 'NO_API_KEY' | 'OFFLINE' | 'PERMISSION_DENIED' | 'UNSUPPORTED' | 'UNKNOWN';
  message?: string;
  sizeMB?: number;
}

export interface STTStrategy {
  /**
   * Probes the current environment to determine if the strategy can run.
   * Returns a detailed result including potential blocking reasons.
   */
  checkAvailability(): Promise<AvailabilityResult>;


  /**
   * Starts the actual transcription stream.
   */
  start(mic?: MicStream): Promise<void>;

  /**
   * Stops the transcription stream and performs necessary cleanup.
   */
  stop(): Promise<void>;

  /**
   * Resumes the transcription stream.
   */
  resume(): Promise<void>;

  /**
   * Pauses the transcription stream.
   */
  pause(): Promise<void>;

  /**
   * Nuclear cleanup of all resources (threads, sockets, caches).
   */
  terminate(): Promise<void>;

  /**
   * Returns the current partial or final transcript.
   */
  getTranscript(): Promise<string>;

  /**
   * Returns the timestamp of the last successful activity for watchdog monitoring.
   */
  getLastHeartbeatTimestamp(): number;

  /**
   * Returns the underlying engine type identifier.
   */
  getEngineType(): string;
}
