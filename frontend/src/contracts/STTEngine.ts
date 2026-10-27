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
    'init', 'start', 'stop'
  ];

  // Optional lifecycle methods are defaulted before validation so lightweight
  // adapters can still satisfy the runtime contract.
  const record = engine as Record<string, unknown>;
  if (typeof record.terminate !== 'function') {
    record.terminate = async () => { logger.debug('STT_ENGINE_TERMINATE_NOOP: Using default no-op'); };
  }
  if (typeof record.destroy !== 'function') {
    record.destroy = async () => { logger.debug('STT_ENGINE_DESTROY_NOOP: Using default no-op'); };
  }
  if (typeof record.pause !== 'function') {
    record.pause = async () => { logger.debug('STT_ENGINE_PAUSE_NOOP: Using default no-op'); };
  }
  if (typeof record.resume !== 'function') {
    record.resume = async () => { logger.debug('STT_ENGINE_RESUME_NOOP: Using default no-op'); };
  }

  /**
   * Prototype-Safe Method Check:
   * Ensures methods are identified even if they live on the prototype chain.
   */
  const hasMethod = (obj: unknown, method: string): boolean => {
    if (!obj || typeof obj !== 'object') return false;
    let current = obj as Record<string, unknown>;
    while (current && current !== Object.prototype) {
      if (Object.prototype.hasOwnProperty.call(current, method)) {
        return typeof current[method] === 'function';
      }
      current = Object.getPrototypeOf(current) as Record<string, unknown>;
    }
    // Final check for class-style methods that might not be detected by hasOwnProperty on the instance
    return typeof (obj as Record<string, unknown>)[method] === 'function';
  };

  for (const method of required) {
    if (!hasMethod(engine, method as string)) {
      // Robust diagnostic: Crawl prototype chain to find what's actually there
      const methods: string[] = [];
      let obj: unknown = engine;
      while (obj && obj !== Object.prototype) {
        methods.push(...Object.getOwnPropertyNames(obj));
        obj = Object.getPrototypeOf(obj);
      }
      throw new Error(
        `STT_ENGINE_INVALID: Engine missing required method '${method}'. ` +
        `Detected methods in entire chain: ${methods.join(', ')}`
      );
    }
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
  protected isStopped: boolean = true;
  /**
   * #1635: advanced at the ENTRY of every destroy/terminate. An init settles only for the generation that
   * started it, so a destroy (or destroy then re-init) while a load is in flight can never be revived by it.
   */
  protected lifecycleGeneration: number = 0;
  /** #1635: the one init in flight; concurrent callers join it instead of starting a second acquisition. */
  private initInFlight: Promise<Result<void, Error>> | null = null;

  protected options: TranscriptionModeOptions | EngineCallbacks = {};

  constructor(options?: TranscriptionModeOptions | EngineCallbacks) {
    this.instanceId = Math.random().toString(36).substring(7);
    this.options = options || {};

    // Propagate owning-service identity to EVERY engine at construction so init
    // logs are attributable. Leaf engines (TransformersJS/V4/WhisperTurbo) call
    // super(options) but previously never copied serviceId/runId, so they always
    // logged serviceId='unknown' — making one decorator-chain init (facade + leaf)
    // look like multiple orphan/"probe" engines. The facade passes its full
    // options (which carry serviceId/runId) to the leaf, so reading them here
    // attributes every layer to the same service. Pure observability; no behavior
    // change (subclass onInit assignments remain and resolve to the same values).
    const identity = options as { serviceId?: string; runId?: string } | undefined;
    if (identity?.serviceId) this.serviceId = identity.serviceId;
    if (identity?.runId) this.runId = identity.runId;
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
  async init(timeoutMs?: number, isMock?: boolean): Promise<Result<void, Error>> {
    // #1635: join an in-flight init BEFORE touching the termination fence, so a second caller can neither
    // start a second acquisition nor un-terminate a destroy that is cancelling the first.
    if (this.initInFlight) return this.initInFlight;
    this.isTerminated = false;
    const attempt = this.initForGeneration(this.lifecycleGeneration, timeoutMs, isMock);
    this.initInFlight = attempt;
    try {
      return await attempt;
    } finally {
      // Cleared on success, Result failure and thrown rejection alike; a newer init is never cleared.
      if (this.initInFlight === attempt) this.initInFlight = null;
    }
  }

  private async initForGeneration(generation: number, timeoutMs?: number, isMock?: boolean): Promise<Result<void, Error>> {
    logger.info({
      type: this.type,
      instanceId: this.instanceId,
      serviceId: this.serviceId
    }, `[STTEngine] Initializing ${this.type}...`);

    const result = await this.onInit(timeoutMs, isMock);

    // A destroy/terminate that began while this init awaited owns the engine now: never mark it initialised.
    if (generation !== this.lifecycleGeneration || this.isTerminated) {
      return Result.err(new Error(`[STTEngine] ${this.type} init cancelled by destroy/terminate.`));
    }
    if (result.isOk) {
      this.isInitialized = true;
      this.updateHeartbeat();
    }

    return result;
  }

  /**
   * #1635: invalidate at the ENTRY of destroy/terminate, before any awaited child teardown, so an init that
   * settles during that teardown sees it. Returns false when a termination already began.
   */
  protected beginTermination(): boolean {
    if (this.isTerminated) return false;
    this.isTerminated = true;
    this.lifecycleGeneration += 1;
    this.isInitialized = false;
    this.initInFlight = null;
    return true;
  }

  /**
   * Abstract hook for engine-specific initialization
   */
  protected abstract onInit(timeoutMs?: number, isMock?: boolean): Promise<Result<void, Error>>;

  /**
   * High-level Start command (Contract Requirement)
   */
  async start(mic?: MicStream, userWords: string[] = []): Promise<void> {
    if (!this.isInitialized) {
      throw new Error(`[STTEngine] Cannot start ${this.type} - not initialized.`);
    }
    this.isTerminated = false;
    this.isStopped = false;
    this.updateHeartbeat();
    await this.onStart(mic, userWords);
  }

  /**
   * Internal start hook for concrete engines
   */
  protected abstract onStart(mic: MicStream | undefined, userWords?: string[]): Promise<void>;

  /**
   * High-level Stop command (Contract Requirement)
   */
  async stop(): Promise<void> {
    if (this.isStopped) {
      logger.debug({ type: this.type }, '[STTEngine] stop() called but already stopped, skipping.');
      return;
    }
    await this.onStop();
    this.isStopped = true;
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
  abstract transcribe(audio: Float32Array, options?: { final?: boolean }): Promise<Result<string, Error>>;

  /**
   * Implementation of destroy from IPrivateSTTEngine
   */
  async destroy(): Promise<void> {
    if (!this.beginTermination()) return; // BLOCK RE-ENTRY AND INVALIDATE ANY IN-FLIGHT INIT IMMEDIATELY
    await this.stop();
    await this.onDestroy();
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

  /**
   * 🛡️ E2E BRIDGE HOOK (v0.6.16)
   * Deterministically injects a transcript update into the engine's callback pipeline.
   * This is the authoritative entry point for Playwright/Browser injection.
   */
  public emitTranscript(text: string, isFinal: boolean = true): void {
    if (this.isStopped) {
      logger.debug({ type: this.type }, '[STTEngine] 🛡️ Guard: Dropping emitTranscript because engine is stopped.');
      return;
    }
    if (this.options && 'onTranscriptUpdate' in this.options) {
      const updateCallback = this.options.onTranscriptUpdate as (update: { transcript: { partial?: string; final?: string } }) => void;
      updateCallback({
        transcript: isFinal ? { final: text } : { partial: text }
      });
    } else {
      logger.warn({ type: this.type }, '[STTEngine] ⚠️ emitTranscript called but no onTranscriptUpdate callback is registered.');
    }
  }

}

/**
 * A DECODING engine, specifically.
 *
 * `validateEngine` above is also applied to the SERVICE, which drives recording through
 * `startTranscription`/`stopTranscription` and legitimately has no `transcribe`. Requiring the method
 * there would reject a correct object, so the stricter check lives here and is applied only where a
 * concrete engine is constructed.
 *
 * It exists because `MoonshineStreamingEngine` shipped without `transcribe` at all. The engine passed
 * `validateEngine`, passed every initialisation test, and would have thrown "not a function" at the
 * first real commit decode — which a user experiences as a recording that silently produced nothing.
 * Construction is the right moment to find that: the alternative is finding it mid-session, after the
 * audio is already gone.
 */
export function assertEngineCanDecode(engine: unknown, engineType: string): void {
  const record = engine as Record<string, unknown> | null;
  if (!record || typeof record.transcribe !== 'function') {
    throw new Error(
      `STT_ENGINE_CANNOT_DECODE: ${engineType} has no transcribe(audio) method, so a committed `
      + 'utterance could never be decoded. Refusing to construct it.',
    );
  }
}
