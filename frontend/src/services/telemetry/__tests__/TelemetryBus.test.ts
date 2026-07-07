import { describe, it, expect, vi } from 'vitest';
import { InMemoryTelemetryBus } from '../TelemetryBus';
import type { TelemetryEvent } from '../contracts';

const evt = (sequence: number): TelemetryEvent => ({ type: 'transcript.final', mode: 'native', t: sequence, text: `s${sequence}`, sequence });

describe('InMemoryTelemetryBus (Phase 2 — shadow transport)', () => {
  it('publishes to all subscribers and buffers events', () => {
    const bus = new InMemoryTelemetryBus('sess-1');
    const a = vi.fn(); const b = vi.fn();
    bus.subscribe(a); bus.subscribe(b);
    bus.publish(evt(0)); bus.publish(evt(1));
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
    expect(bus.getBufferedEvents().map(e => (e as { sequence: number }).sequence)).toEqual([0, 1]);
  });

  it('unsubscribe stops delivery to that listener only', () => {
    const bus = new InMemoryTelemetryBus();
    const a = vi.fn(); const b = vi.fn();
    const off = bus.subscribe(a); bus.subscribe(b);
    bus.publish(evt(0));
    off();
    bus.publish(evt(1));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    expect(bus.subscriberCount).toBe(1);
  });

  it('is bounded — never grows past maxBuffered (drops oldest)', () => {
    const bus = new InMemoryTelemetryBus('s', 3);
    for (let i = 0; i < 6; i++) bus.publish(evt(i));
    const seqs = bus.getBufferedEvents().map(e => (e as { sequence: number }).sequence);
    expect(seqs).toEqual([3, 4, 5]);
  });

  it('reset clears the buffer + rebinds session id, but keeps subscribers (wiring)', () => {
    const bus = new InMemoryTelemetryBus('s1');
    const a = vi.fn(); bus.subscribe(a);
    bus.publish(evt(0));
    bus.reset('s2');
    expect(bus.getBufferedEvents()).toHaveLength(0);
    expect(bus.currentSessionId).toBe('s2');
    expect(bus.subscriberCount).toBe(1);
    bus.publish(evt(9));
    expect(a).toHaveBeenCalledTimes(2); // still subscribed across reset
  });

  it('a throwing subscriber never breaks publish or other subscribers', () => {
    const bus = new InMemoryTelemetryBus();
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    bus.subscribe(bad); bus.subscribe(good);
    expect(() => bus.publish(evt(0))).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
