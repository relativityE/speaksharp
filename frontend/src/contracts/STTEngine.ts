import { IPrivateSTTEngine, EngineType, EngineCallbacks } from './IPrivateSTTEngine';
import { ITranscriptionEngine, TranscriptionModeOptions, Result } from '../services/transcription/modes/types';
import logger from '@/lib/logger';
import { MicStream } from '../services/transcription/utils/types';

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
    throw new Error('STT_ENGINE_INVALID: Engine is not an object');
  }

  // These three methods define the core contract
  const required = ['start', 'stop', 'getEngineType'] as const;

  for (const method of required) {
    if (typeof (engine as Record<string, unknown>)[method] !== 'function') {
      throw new Error(`STT_ENGINE_INVALID: Engine missing required method '${method}'`);
    }
  }

  // Optional: Provide default no-op for cleanup methods if not present
  if (typeof (engine as Record<string, unknown>).terminate !== 'function') {
    (engine as Record<string, unknown>).terminate = () => {}; // Default no-op
  }
  if (typeof (engine as Record<string, unknown>).destroy !== 'function') {
    (engine as Record<string, unknown>).destroy = () => {}; // Default no-op
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

  constructor() {
    this.instanceId = Math.random().toString(36).substring(7);
  }

  /**
   * Common Initialization Logic
   */
  async init(callbacks: TranscriptionModeOptions | EngineCallbacks, timeoutMs?: number): Promise<Result<void, Error>> {
    // Adapter logic to handle both interface styles
    this.serviceId = (callbacks as Record<string, unknown>).serviceId as string || 'unknown';
    this.runId = (callbacks as Record<string, unknown>).runId as string || 'unknown';

    logger.info({
      type: this.type,
      instanceId: this.instanceId,
      serviceId: this.serviceId
    }, `[STTEngine] Initializing ${this.type}...`);

    const result = await this.onInit(callbacks as unknown as EngineCallbacks, timeoutMs);

    if (result.isOk === true) {
      this.isInitialized = true;
      this.updateHeartbeat();
    }

    return result;
  }

  /**
   * Abstract hook for engine-specific initialization
   */
  protected abstract onInit(callbacks: EngineCallbacks, timeoutMs?: number): Promise<Result<void, Error>>;

  /**
   * High-level Start command (Contract Requirement)
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error(`[STTEngine] Cannot start ${this.type} - not initialized.`);
    }
    this.updateHeartbeat();
    await this.onStart();
  }

  protected abstract onStart(): Promise<void>;

  /**
   * High-level Stop command (Contract Requirement)
   */
  async stop(): Promise<void> {
    await this.onStop();
    this.updateHeartbeat();
  }

  protected abstract onStop(): Promise<void>;

  /**
   * Implementation of transcribe from IPrivateSTTEngine
   */
  abstract transcribe(audio: Float32Array): Promise<Result<string, Error>>;

  /**
   * Implementation of destroy from IPrivateSTTEngine
   */
  async destroy(): Promise<void> {
    await this.stop();
    await this.onDestroy();
    this.isInitialized = false;
  }

  protected abstract onDestroy(): Promise<void>;

  /**
   * Optional Nuclear Termination (Contract Requirement)
   */
  async terminate(): Promise<void> {
    // Default empty implementation to satisfy validateEngine contract
    logger.debug(`[STTEngine] No-op terminate called for ${this.type}`);
  }

  /**
   * Heartbeat Monitoring (Contract Requirement)
   */
  public getLastHeartbeatTimestamp(): number {
    return this.lastHeartbeat;
  }

  protected updateHeartbeat(): void {
    this.lastHeartbeat = Date.now();
  }

  /**
   * Implementation of ITranscriptionEngine (Legacy Bridge)
   */
  public async startTranscription(_mic?: MicStream): Promise<void> {
    // mic is managed by the service orchestrator, but we satisfy the interface
    await this.start();
  }

  public async stopTranscription(): Promise<string> {
    await this.stop();
    return this.getTranscript();
  }

  public async getTranscript(): Promise<string> {
    return this.currentTranscript;
  }

  public getEngineType(): string {
    return this.type;
  }

  public dispose(): void {
    this.destroy().catch(err => logger.error({ err }, '[STTEngine] Async destruction failed in dispose'));
  }
}
