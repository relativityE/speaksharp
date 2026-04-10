import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { analyticsBuffer } from '../AnalyticsBuffer';
import posthog from 'posthog-js';

// Mock PostHog
vi.mock('posthog-js', () => ({
  default: {
    capture: vi.fn(),
    identify: vi.fn()
  }
}));

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
    analyticsBuffer.push('Event 1', { id: 1 }, 'LOW');
    analyticsBuffer.push('Event 2', { id: 2 }, 'LOW');

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
    analyticsBuffer.push('CRITICAL_EVENT', { crash: true }, 'CRITICAL');
    expect(posthog.capture).toHaveBeenCalledWith('CRITICAL_EVENT', expect.objectContaining({
      $priority: 'CRITICAL'
    }));
  });

  it('should drop oldest events when BATCH_SIZE exceeded (Backpressure)', async () => {
    const MAX = analyticsBuffer.MAX_QUEUE_SIZE;
    
    // Flood with 1005 events
    for (let i = 0; i < MAX + 5; i++) {
        analyticsBuffer.push(`Event ${i}`, { i }, 'LOW');
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

  it('should attach monotonic timestamps and priority metadata', async () => {
    analyticsBuffer.ready = true;
    analyticsBuffer.push('TimestampTest', { data: 1 }, 'HIGH');
    
    await vi.advanceTimersByTimeAsync(0);
    expect(posthog.capture).toHaveBeenCalledWith('TimestampTest', expect.objectContaining({
        $priority: 'HIGH',
        $ts: expect.any(Number)
    }));
  });
});
