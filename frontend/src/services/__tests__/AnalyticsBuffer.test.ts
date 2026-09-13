import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { analyticsBuffer } from '../AnalyticsBuffer';
import { ENVELOPE_KEYS } from '../telemetry/envelope';
import posthog from 'posthog-js';
import * as Sentry from '@sentry/react';

/**
 * These are TRANSPORT tests — queueing, priority, batching, timestamps. They are deliberately indifferent
 * to the schema registry, so they use synthetic names cast through this helper. Governance is proven in
 * telemetryAllowlist.test.ts against the REAL producers; casting here weakens nothing in production, where
 * `push` only accepts `GovernedEvent | private_${string}`.
 */
const transportEvent = (name: string) => name as Parameters<typeof analyticsBuffer.push>[0];

// Mock PostHog
vi.mock('posthog-js', () => ({
  default: {
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    reloadFeatureFlags: vi.fn(),
    _isIdentified: vi.fn()
  }
}));

// Mock Sentry so identity-path assertions (setUser) are observable.
vi.mock('@sentry/react', () => ({ setUser: vi.fn() }));

describe('AnalyticsBuffer (Hardened Background Asset)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Reset internal state for T=0 verification
    analyticsBuffer.queue = [];
    analyticsBuffer.ready = false;
    analyticsBuffer.isFlushing = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should queue events while not ready and flush asynchronously upon signal', async () => {
    analyticsBuffer.push(transportEvent('Event 1'), { id: 1 }, 'LOW');
    analyticsBuffer.push(transportEvent('Event 2'), { id: 2 }, 'LOW');

    expect(posthog.capture).not.toHaveBeenCalled();
    expect(analyticsBuffer.queue.length).toBe(2);

    // Act: Signal Ready
    analyticsBuffer.flush();
    expect(analyticsBuffer.ready).toBe(true);
    
    // Telemetry should NOT be sent yet (scheduled for background)
    expect(posthog.capture).not.toHaveBeenCalled();

    // Advance 1 tick -> First batch
    await vi.advanceTimersToNextTimerAsync();
    expect(posthog.capture).toHaveBeenCalled();
  });

  it('should deliver CRITICAL events immediately if ready (QoS Sovereignty)', async () => {
    analyticsBuffer.ready = true;
    
    // Critical bypasses queue
    analyticsBuffer.push(transportEvent('CRITICAL_EVENT'), { crash: true }, 'CRITICAL');
    expect(posthog.capture).toHaveBeenCalledWith('CRITICAL_EVENT', expect.objectContaining({
      $priority: 'CRITICAL'
    }));
  });

  it('flushes queued events before sending a critical event to preserve ordering', () => {
    analyticsBuffer.ready = true;
    analyticsBuffer.queue.push({
      event: 'QUEUED_EVENT',
      properties: { step: 1 },
      priority: 'LOW',
      timestamp: Date.now(),
    });

    analyticsBuffer.push(transportEvent('CRITICAL_EVENT'), { crash: true }, 'CRITICAL');

    expect(vi.mocked(posthog.capture).mock.calls.map(([event]) => event)).toEqual([
      'QUEUED_EVENT',
      'CRITICAL_EVENT',
    ]);
  });

  it('should drop oldest events when BATCH_SIZE exceeded (Backpressure)', async () => {
    const MAX = analyticsBuffer.MAX_QUEUE_SIZE;
    
    // Flood with 1005 events
    for (let i = 0; i < MAX + 5; i++) {
        analyticsBuffer.push(transportEvent(`Event ${i}`), { i }, 'LOW');
    }

    expect(analyticsBuffer.queue.length).toBe(MAX);
    // Oldest 5 should have been dropped
    expect(analyticsBuffer.queue[0].event).toBe('Event 5');
  });

  it('should split large flushes into non-blocking batches (Adaptive Batching)', async () => {
    analyticsBuffer.ready = true;
    
    // Queue 25 events
    for (let i = 0; i < 25; i++) {
        analyticsBuffer.queue.push({ 
            event: `BatchEvent ${i}`, 
            priority: 'LOW', 
            timestamp: Date.now() 
        });
    }

    // Trigger flush
    analyticsBuffer.scheduleFlush();

    // Tick 1
    await vi.advanceTimersToNextTimerAsync();
    const firstCallCount = vi.mocked(posthog.capture).mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);
    expect(firstCallCount).toBeLessThan(25); // Must have yielded!

    // Tick 2
    await vi.advanceTimersToNextTimerAsync();
    const secondCallCount = vi.mocked(posthog.capture).mock.calls.length;
    expect(secondCallCount).toBeGreaterThan(firstCallCount); // Verified: Multiple batches

    // Final
    await vi.runAllTimersAsync();
    expect(posthog.capture).toHaveBeenCalledTimes(25);
  });

  it('should attach absolute timestamps and priority metadata', async () => {
    vi.setSystemTime(new Date('2026-05-22T12:00:00.000Z'));
    analyticsBuffer.ready = true;
    analyticsBuffer.push(transportEvent('TimestampTest'), { data: 1 }, 'HIGH');
    
    await vi.advanceTimersByTimeAsync(0);
    expect(posthog.capture).toHaveBeenCalledWith('TimestampTest', expect.objectContaining({
        $priority: 'HIGH',
        $ts: new Date('2026-05-22T12:00:00.000Z').getTime()
    }));
  });

  it('an UNGOVERNED event ships no properties at all — fail closed, not redact', () => {
    // POLICY CHANGE (#1259 T1). This test previously asserted denylist behaviour: sensitive-looking keys
    // were REDACTED into {length, words, redacted} and everything else passed through. That failed on the
    // key's NAME, so `message`, `reason` and `notes` sailed past.
    //
    // The policy is now an allowlist keyed by EVENT. `PrivacyTest` has no schema, so it ships nothing.
    // The old expectations are deliberately not restored: making them green again would reinstate the
    // defect.
    analyticsBuffer.ready = true;

    analyticsBuffer.push(transportEvent('PrivacyTest'), {
      transcript: 'um this private transcript must not leave',
      audioDataUrl: 'data:audio/wav;base64,very-sensitive',
      nested: { finalTranscript: 'another sensitive transcript', safeMode: 'private' },
      values: [{ transcriptExcerpt: 'nested array transcript' }],
    }, 'CRITICAL');
    analyticsBuffer.flush();

    const call = ((posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls.slice(-1)[0]);
    expect(call[0]).toBe('PrivacyTest');
    const payload = call[1] as Record<string, unknown>;
    for (const k of ['transcript', 'audioDataUrl', 'nested', 'values']) {
      expect(payload).not.toHaveProperty(k);
    }
    // Nothing sensitive survives in any form — not even a redaction summary.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('transcript');
    expect(serialized).not.toContain('sensitive');
    // Only the buffer's own metadata and the GOVERNED EVENT ENVELOPE remain. The envelope is ambient
    // context added at the seam ($-prefixed keys are PostHog's own); it carries no producer data, which
    // is why an ungoverned event still ships it while shipping none of the producer's properties.
    // Read from ENVELOPE_KEYS rather than a copy: a hand-maintained duplicate went stale the moment
    // the envelope gained the correlation identity, and a stale copy here fails the test for the one
    // reason that is not a defect.
    const allowedNonProducer = new Set(ENVELOPE_KEYS);
    expect(Object.keys(payload).every(k => k.startsWith('$') || allowedNonProducer.has(k))).toBe(true);
    // and the envelope itself must never carry producer content.
    expect(payload).toHaveProperty('traffic_type');
    expect(JSON.stringify(payload)).not.toContain('sensitive');
  });

  // #1259 — THE V4 PROJECTION NOW RUNS AT THE BOUNDARY, because the side channel that used to apply it
  // is gone. `private_stt_v4_*` shares the `private_*` namespace with the Private engineering events but
  // uses a DIFFERENT allowlist, so the namespace alone cannot select the projection: applying the
  // Private allowlist to a v4 event would drop every v4 field and ship three convincingly empty events.
  it('projects a private_stt_v4_* event through the V4 allowlist, not the Private one', () => {
    analyticsBuffer.ready = true;

    analyticsBuffer.push('private_stt_v4_ready', {
      variant: 'base_q4',
      loadMs: 900,
      resolvedDevice: 'webgpu',
      email: 'leak@example.com',
      transcript: 'um this must not leave',
    }, 'CRITICAL');

    const call = ((posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls.slice(-1)[0]);
    expect(call[0]).toBe('private_stt_v4_ready');
    const payload = call[1] as Record<string, unknown>;
    // V4 fields survive — under the Private allowlist every one of these would have been dropped.
    expect(payload).toMatchObject({ variant: 'base_q4', loadMs: 900, resolvedDevice: 'webgpu' });
    // Content never does.
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('transcript');
    expect(JSON.stringify(payload)).not.toContain('must not leave');
    // And it carries the envelope, which the direct-capture path could not attach.
    expect(payload).toHaveProperty('traffic_type');
    expect(payload).toHaveProperty('journey_id');
  });

  // #1259 P2 — a SECOND redaction boundary for Private events: even if a `private_*` event's props bypass
  // the emitter allowlist, the send boundary re-projects them through the Private allowlist, so no
  // non-allowlisted field (transcript, email, raw id) can leave the browser on a Private event.
  it('re-applies the Private allowlist to private_* events at the send boundary (#1259 P2)', () => {
    vi.mocked(posthog.capture).mockClear();
    analyticsBuffer.ready = true;

    analyticsBuffer.push('private_error', {
      error_code: 'SetupError',        // allowlisted → survives
      transcript: 'um leaked words',   // NOT allowlisted → dropped by the second boundary
      email: 'user@example.com',       // NOT allowlisted → dropped
      user_id: '8f14e45f-ceea-467a',   // NOT allowlisted → dropped
    }, 'CRITICAL');

    const [name, props] = vi.mocked(posthog.capture).mock.calls[0];
    expect(name).toBe('private_error');
    expect(props).toMatchObject({ error_code: 'SetupError' });
    expect(props).not.toHaveProperty('transcript');
    expect(props).not.toHaveProperty('email');
    expect(props).not.toHaveProperty('user_id');
    const payload = JSON.stringify(props);
    expect(payload).not.toContain('leaked words');
    expect(payload).not.toContain('user@example.com');
    expect(payload).not.toContain('8f14e45f');
  });
});

describe('AnalyticsBuffer identity (account-linked PostHog identity)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('identify() passes through the user id (no email) and reloads feature flags', () => {
    analyticsBuffer.identify('user-123');
    // #1259 T1: identify() no longer accepts a properties argument at all.
    expect(posthog.identify).toHaveBeenCalledWith('user-123');
    expect(posthog.reloadFeatureFlags).toHaveBeenCalled(); // flags re-evaluated for the identified user
  });

  it('identify() emits ONE minimal non-PII materialization event sent INSTANTLY (Gate B person creation)', () => {
    analyticsBuffer.identify('user-123');
    // send_instantly skips the batch queue so the /e/ request fires immediately and PostHog
    // materializes a queryable person at user.id (identified_only mode) even on a short session.
    // The envelope rides along here too: this capture deliberately bypasses the buffer, and without it
    // a CANARY login would be indistinguishable from a user login.
    expect(posthog.capture).toHaveBeenCalledWith(
      'account_identified',
      expect.objectContaining({ source: 'auth_provider', traffic_type: expect.any(String) }),
      { send_instantly: true },
    );
    // STRICT no-PII: the materialization event must never carry email/name/transcript/audio/etc.
    const payload = JSON.stringify(vi.mocked(posthog.capture).mock.calls);
    expect(payload).not.toMatch(/email|@|transcript|audio|password|token|name/i);
  });

  it('identify() materializes (capture) BEFORE reloading flags so eval reflects the new person', () => {
    analyticsBuffer.identify('user-123');
    const captureOrder = vi.mocked(posthog.capture).mock.invocationCallOrder[0];
    const reloadOrder = vi.mocked(posthog.reloadFeatureFlags).mock.invocationCallOrder[0];
    expect(captureOrder).toBeLessThan(reloadOrder);
  });

  it('keeps the materialization capture NON-FATAL: a capture throw must not block flag reload / Sentry', () => {
    // The account_identified capture is best-effort; flag reload after identify is the load-bearing
    // step and must always run, plus identify() must never throw out of its catch.
    vi.mocked(posthog.capture).mockImplementationOnce(() => { throw new Error('capture boom'); });

    expect(() => analyticsBuffer.identify('user-123')).not.toThrow();

    // #1259 T1: identify() no longer accepts a properties argument at all.
    expect(posthog.identify).toHaveBeenCalledWith('user-123');
    // The envelope rides along here too: this capture deliberately bypasses the buffer, and without it
    // a CANARY login would be indistinguishable from a user login.
    expect(posthog.capture).toHaveBeenCalledWith(
      'account_identified',
      expect.objectContaining({ source: 'auth_provider', traffic_type: expect.any(String) }),
      { send_instantly: true },
    );
    expect(posthog.reloadFeatureFlags).toHaveBeenCalled(); // still runs despite capture failure
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'user-123' }); // still runs despite capture failure
  });

  it('resetIdentity() resets PostHog to a fresh anonymous id and reloads flags', () => {
    analyticsBuffer.resetIdentity();
    expect(posthog.reset).toHaveBeenCalledTimes(1);
    expect(posthog.reloadFeatureFlags).toHaveBeenCalled();
  });

  it('isIdentified() reflects PostHog persisted identity state (used to clear stale cross-boot identity)', () => {
    const isIdentifiedMock = (posthog as unknown as { _isIdentified: ReturnType<typeof vi.fn> })._isIdentified;
    isIdentifiedMock.mockReturnValue(true);
    expect(analyticsBuffer.isIdentified()).toBe(true);

    isIdentifiedMock.mockReturnValue(false);
    expect(analyticsBuffer.isIdentified()).toBe(false);
  });

  it('isIdentified() never throws and is false when the posthog signal is unavailable', () => {
    const isIdentifiedMock = (posthog as unknown as { _isIdentified: ReturnType<typeof vi.fn> })._isIdentified;
    isIdentifiedMock.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => analyticsBuffer.isIdentified()).not.toThrow();
    expect(analyticsBuffer.isIdentified()).toBe(false);
  });
});
