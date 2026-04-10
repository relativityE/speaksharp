import { IPrivateSTTEngine, EngineType, EngineCallbacks } from './IPrivateSTTEngine';
import { ITranscriptionEngine, TranscriptionModeOptions, Result } from '@/services/transcription/modes/types';
import { AvailabilityResult } from '@/services/transcription/STTStrategy';
import logger from '../lib/logger';
import { MicStream } from '@/services/transcription/utils/types';

/**
 * ARCHITECTURE:
 * STTEngine is the Mandatory Base Class for all Speech-to-Text engines.
 * 
 * DESIGN RATIONALE:
 * By using an abstract base class instead of just an interface, we can:
 * 1. Enforce common telemetry (heartbeats).
 * 2. Provide a unified logging foundation.
 * 3. Ensure deterministic lifecycle management (init -> start -> stop).
 */

/**
 * Run-time Guard: Verifies that an engine instance conforms to the structural contract.
 * Rationale: instanceof is unreliable in sharded environments.
 */
export function validateEngine(engine: unknown): asserts engine is IPrivateSTTEngine {
  if (!engine || typeof engine !== 'object') {
    throw new Error('STT_ENGINE_INVALID: Engine must be an object');
  }

  const required: Array<keyof IPrivateSTTEngine> = [
    'init', 'start', 'stop', 'pause', 'resume', 'destroy'
  ];

  for (const method of required) {
    const engineAsRecord = engine as Record<string, unknown>;
    

    if (!(method in engineAsRecord) || typeof engineAsRecord[method] !== 'function') {
      // Robust diagnostic: Crawl prototype chain to find what's actually there
      const methods: string[] = [];
      let obj: unknown = engine;
      while (obj && obj !== Object.prototype) {
        methods.push(...Object.getOwnPropertyNames(obj));
        obj = Object.getPrototypeOf(obj);
      }
      throw new Error(
        `STT_ENGINE_INVALID: Engine missing required method '${method}'. ` +
        `Detected methods in entire chain: ${methods.filter(m => typeof engineAsRecord[m] === 'function').join(', ')}`
      );
    }
  }

  // Optional: Provide default no-op for cleanup methods if not present
  const record = engine as Record<string, unknown>;
  if (typeof record.terminate !== 'function') {
    record.terminate = async () => { logger.debug('STT_ENGINE_TERMINATE_NOOP: Using default no-op'); };
  }
  if (typeof record.destroy !== 'function') {
    record.destroy = async () => { logger.debug('STT_ENGINE_DESTROY_NOOP: Using default no-op'); };
  }
}

export abstract class STTEngine implements IPrivateSTTEngine, ITranscriptionEngine {

  public abstract readonly type: EngineType;
  public readonly instanceId: string;

  protected lastHeartbeat: number = 0;
  protected isInitialized: boolean = false;
  protected serviceId: string = 'unknown';
  protected runId: string = 'unknown';
  protected currentTranscript: string = '';
  protected isTerminated: boolean = false;

  protected options: TranscriptionModeOptions | EngineCallbacks | null = null;

  constructor(options?: TranscriptionModeOptions | EngineCallbacks) {
    this.instanceId = Math.random().toString(36).substring(7);
    this.options = options || null;
  }

  /**
   * STTStrategy Requirement: Probes environment for availability.
   * Default implementation for engines.
   */
  public async checkAvailability(): Promise<AvailabilityResult> {
    return { isAvailable: true };
  }


  /**
   * Common Initialization Logic
   */
  async init(timeoutMs?: number): Promise<Result<void, Error>> {
    logger.info({
      type: this.type,
      instanceId: this.instanceId,
      serviceId: this.serviceId
    }, `[STTEngine] Initializing ${this.type}...`);

    const result = await this.onInit(timeoutMs);

    if (result.isOk) {
      this.isInitialized = true;
      this.updateHeartbeat();
    }

    return result;
  }

  /**
   * Abstract hook for engine-specific initialization
   */
  protected abstract onInit(timeoutMs?: number): Promise<Result<void, Error>>;

  /**
   * High-level Start command (Contract Requirement)
   */
  async start(mic?: MicStream): Promise<void> {
    if (!this.isInitialized) {
      throw new Error(`[STTEngine] Cannot start ${this.type} - not initialized.`);
    }
    this.updateHeartbeat();
    await this.onStart(mic);
  }

  protected abstract onStart(mic?: MicStream): Promise<void>;

  /**
   * High-level Stop command (Contract Requirement)
   */
  async stop(): Promise<void> {
    await this.onStop();
    this.updateHeartbeat();
  }

  protected abstract onStop(): Promise<void>;

  /**
   * High-level Pause command (Contract Requirement)
   */
  async pause(): Promise<void> {
    await this.onPause();
    this.updateHeartbeat();
  }

  protected async onPause(): Promise<void> {
    // Default no-op
  }

  /**
   * High-level Resume command (Contract Requirement)
   */
  async resume(): Promise<void> {
    await this.onResume();
    this.updateHeartbeat();
  }

  protected async onResume(): Promise<void> {
    // Default no-op
  }

  /**
   * Implementation of transcribe from IPrivateSTTEngine
   */
  abstract transcribe(audio: Float32Array): Promise<Result<string, Error>>;

  /**
   * Implementation of destroy from IPrivateSTTEngine
   */
  async destroy(): Promise<void> {
    if (this.isTerminated) return;
    await this.stop();
    await this.onDestroy();
    this.isInitialized = false;
    this.isTerminated = true;
  }

  protected abstract onDestroy(): Promise<void>;

  /**
   * Update engine options at runtime.
   * Default implementation allows re-wiring callbacks.
   */
  public updateOptions(options: Partial<Record<string, unknown>>): void {
    this.options = { ...(this.options || {}), ...options } as TranscriptionModeOptions;
  }

  /**
   * Optional Nuclear Termination (Contract Requirement)
   * Hardened to ensure settlement by calling destroy().
   */
  async terminate(): Promise<void> {
    if (this.isTerminated) return;
    logger.info({ type: this.type, instanceId: this.instanceId }, `[STTEngine] 🛑 Nuclear termination requested for ${this.type}`);
    await this.destroy();
  }

  /**
   * Heartbeat Monitoring (Contract Requirement)
   */
  public getLastHeartbeatTimestamp(): number {
    return this.lastHeartbeat;
  }

  /** @internal */
  public updateHeartbeat(): void {
    this.lastHeartbeat = Date.now();
  }

  public async getTranscript(): Promise<string> {
    return this.currentTranscript;
  }

  public getEngineType(): string {
    return this.type;
  }

}
