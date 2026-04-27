import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { STT_CONFIG } from '../../config';

// Mock dependencies
vi.mock('../../lib/logger');
vi.mock('../transcription/TranscriptionService');

describe('SpeechRuntimeController: Heartbeat Watchdog', () => {
  let controller: unknown;
  let mockService: Record<string, unknown>;

  beforeEach(() => {
    vi.useFakeTimers();

    // Clear Singleton instance for clean test state
    (SpeechRuntimeController as unknown as { instance: undefined }).instance = undefined;
    controller = (SpeechRuntimeController as unknown as { getInstance: () => unknown }).getInstance();

    // Setup mock service
    mockService = {
      getStrategy: vi.fn().mockReturnValue({}),
      getLastHeartbeatTimestamp: vi.fn().mockReturnValue(Date.now()),
      getMode: vi.fn().mockReturnValue('private'),
      warmUp: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      handleHeartbeatFailure: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };

    (controller as { service: unknown }).service = mockService;
    (controller as { isEngineReady: boolean }).isEngineReady = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should trigger recovery when heartbeat drift exceeds threshold', async () => {
    const handleHeartbeatFailureSpy = vi.spyOn(controller as { handleHeartbeatFailure: (e: Error) => void }, 'handleHeartbeatFailure');

    // 1. Start the watchdog (simulating a recording session)
    (controller as { startWatchdog: (s: unknown) => void }).startWatchdog(mockService);

    // 2. Mock a frozen heartbeat (last heartbeat was 31 seconds ago)
    const threshold = STT_CONFIG.HEARTBEAT_TIMEOUT_MS; // 30000ms
    mockService.getLastHeartbeatTimestamp = vi.fn().mockReturnValue(Date.now() - (threshold + 1000));

    // 3. Advance timers by one watchdog period (5s)
    await vi.advanceTimersByTimeAsync(5001);

    // 4. Assert recovery was triggered
    expect(handleHeartbeatFailureSpy).toHaveBeenCalled();

    // handleHeartbeatFailure transitions to FAILED, which immediately chains to FAILED_VISIBLE
    expect((controller as { getState: () => string }).getState()).toBe('FAILED_VISIBLE');

    // 5. Verify it eventually transitions to TERMINATED after visibility hold
    const holdTime = STT_CONFIG.VISIBLE_HOLD_DURATION_MS; // 2500ms
    await vi.advanceTimersByTimeAsync(holdTime + 100);
    expect((controller as { getState: () => string }).getState()).toBe('TERMINATED');
  });

  it('should not trigger recovery when heartbeat is healthy', async () => {
    const handleHeartbeatFailureSpy = vi.spyOn(controller as { handleHeartbeatFailure: (e: Error) => void }, 'handleHeartbeatFailure');

    // 1. Start the watchdog
    (controller as { startWatchdog: (s: unknown) => void }).startWatchdog(mockService);

    // 2. Mock a healthy heartbeat (last heartbeat was 2 seconds ago)
    mockService.getLastHeartbeatTimestamp = vi.fn().mockReturnValue(Date.now() - 2000);

    // 3. Advance timers by one watchdog period
    await vi.advanceTimersByTimeAsync(5001);

    // 4. Assert no recovery
    expect(handleHeartbeatFailureSpy).not.toHaveBeenCalled();
    expect((controller as { getState: () => string }).getState()).not.toBe('FAILED');
  });
});
