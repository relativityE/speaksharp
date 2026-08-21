import { describe, it, expect, vi, beforeEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { STTStrategyFactory } from '../STTStrategyFactory';
import { Result } from '../modes/types';
import { NavigateFunction } from 'react-router-dom';
import { createMicStream } from '../utils/audioUtils';
import type { SttStatus } from '@/types/transcription';
import type { MicStream } from '../utils/types';

const LEAF_MESSAGE = "Unable to load a worklet's module.";

vi.mock('../STTStrategyFactory');
// Simulate the AudioWorklet/mic acquisition failure that fails Cloud/Private start on the protected
// preview (and would fail for any real user whose worklet asset fails to load).
vi.mock('../utils/audioUtils', () => ({
  createMicStream: vi.fn().mockRejectedValue(new Error("Unable to load a worklet's module.")),
}));

vi.mock('@/lib/toast', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

describe('TranscriptionService — engine-start leaf capture (#P1 observability)', () => {
  let service: TranscriptionService;
  let statusUpdates: SttStatus[];

  beforeEach(() => {
    vi.clearAllMocks();
    statusUpdates = [];
    vi.mocked(STTStrategyFactory.create).mockReturnValue({
      checkAvailability: vi.fn().mockResolvedValue({ isAvailable: true }),
      init: vi.fn().mockResolvedValue(Result.ok(undefined)),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      terminate: vi.fn().mockResolvedValue(undefined),
      getEngineType: vi.fn().mockReturnValue('mock'),
    } as unknown as ReturnType<typeof STTStrategyFactory.create>);

    service = new TranscriptionService({
      onTranscriptUpdate: vi.fn(),
      onModelLoadProgress: vi.fn(),
      onReady: vi.fn(),
      onStatusChange: (s: SttStatus) => statusUpdates.push(s),
      session: null,
      navigate: vi.fn() as unknown as NavigateFunction,
    });
  });

  it('captures the mic/worklet leaf in getStartError() when start fails', async () => {
    await service.init();

    expect(service.getState()).toBe('FAILED');
    // AC #1/#2: the raw leaf is captured and exposed for the controller to attach as cause.
    expect(service.getStartError()).toBeInstanceOf(Error);
    expect(service.getStartError()?.message).toBe(LEAF_MESSAGE);
  });

  it('keeps user-facing FAILED status generic — never the raw leaf (AC #5)', async () => {
    await service.init();

    const errorStatuses = statusUpdates.filter((s) => s.type === 'error');
    const failedStatus = errorStatuses[errorStatuses.length - 1];
    expect(failedStatus, 'a FAILED/error status should have been emitted').toBeTruthy();
    // AC #5: the visible copy must NOT be the raw browser/engine exception.
    expect(failedStatus!.message).not.toContain('worklet');
    expect(failedStatus!.message).not.toBe(LEAF_MESSAGE);
    // It is the approved safe fallback copy.
    expect(failedStatus!.message).toMatch(/could not start/i);
  });

  it('clears the stale leaf on a fresh start attempt (no misattribution)', async () => {
    await service.init();
    expect(service.getStartError()?.message).toBe(LEAF_MESSAGE);

    // Next attempt: the mic now succeeds → startTranscription clears startError at entry and no mic
    // catch re-sets it, so a stale leaf from the prior failed init can never linger.
    const okMic = { stop: vi.fn(), onFrame: vi.fn().mockReturnValue(() => {}) } as unknown as MicStream;
    vi.mocked(createMicStream).mockResolvedValue(okMic);

    await service.startTranscription().catch(() => { /* later engine specifics irrelevant to the clear */ });

    expect(service.getStartError()).toBeNull();
  });
});
