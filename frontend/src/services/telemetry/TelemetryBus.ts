import type { TelemetryBus, TelemetryEvent } from './contracts';

const DEFAULT_MAX_BUFFERED = 5_000;

/**
 * Session-scoped, in-memory Telemetry Bus (Phase 2 — SHADOW).
 *
 * TRANSPORT ONLY: fan-out to subscribers + a bounded ring buffer for forensics. It derives NO metrics,
 * owns NO React state, and holds NO business logic. Publish is synchronous (subscribers are called
 * inline); a throwing subscriber can never break publish or the other subscribers. Bounded so a long
 * session cannot grow memory without limit.
 */
export class InMemoryTelemetryBus implements TelemetryBus {
  private listeners = new Set<(event: TelemetryEvent) => void>();
  private buffer: TelemetryEvent[] = [];
  private sessionId: string;
  private readonly maxBuffered: number;

  constructor(sessionId = 'unset', maxBuffered = DEFAULT_MAX_BUFFERED) {
    this.sessionId = sessionId;
    this.maxBuffered = maxBuffered;
  }

  publish(event: TelemetryEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.maxBuffered) this.buffer.shift();
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* a bad subscriber must not break the bus or other subscribers */
      }
    }
  }

  subscribe(listener: (event: TelemetryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Start a new session: clear buffered events + rebind the session id. Subscribers (wiring) persist. */
  reset(sessionId: string): void {
    this.sessionId = sessionId;
    this.buffer = [];
  }

  /** Forensic read of buffered events — used by tests/diagnostics in the shadow phase, NOT by UI. */
  getBufferedEvents(): readonly TelemetryEvent[] {
    return this.buffer;
  }

  get currentSessionId(): string {
    return this.sessionId;
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }
}
