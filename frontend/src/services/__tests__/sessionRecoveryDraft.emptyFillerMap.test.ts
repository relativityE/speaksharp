import { beforeEach, describe, expect, it } from 'vitest';
import { getSessionRecoveryDraft, saveSessionRecoveryDraft } from '@/services/sessionRecoveryDraft';

// #1472 casualty (consolidated #1456). `complete_session_v2` rejects a completed session whose filler map is NULL
// (23514: "send {} for a genuine zero, never null"). The Retry Save path replays `draft.metrics.fillerCounts ?? null`,
// so a draft that silently drops an empty map turns every retry of a zero-filler session into a permanent rejection.
// Whether that zero is a verified clean result is decided by filler completeness, never by dropping the map here.
const nextActionSignal = {
  reasonCode: 'PACE_TOO_FAST', actionCode: 'SLOW_DOWN', metric: 'wpm', value: 170, comparator: 'above_target', templateVersion: 'rec_v1',
} as const;

const saveFinalized = (fillerCounts: unknown) => saveSessionRecoveryDraft({
  sessionId: 'session-zero',
  userId: 'user-1',
  recoveryState: 'finalized_pending_save',
  durationSeconds: 90,
  mode: 'private',
  metrics: { totalWords: 180, wpm: 170, fillerCounts: fillerCounts as Record<string, number> },
  nextActionSignal,
});

describe('#1472 / #1456 — a recovery draft keeps an empty filler map so Retry Save stays replayable', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('CASUALTY: an empty filler map survives the draft write/read boundary as {}, not undefined', () => {
    saveFinalized({});
    const draft = getSessionRecoveryDraft();
    expect(draft?.recoveryState).toBe('finalized_pending_save');
    expect(draft?.metrics.fillerCounts).toEqual({});
    // The retry payload the controller builds from this draft must not become NULL.
    expect(draft?.metrics.fillerCounts ?? null).not.toBeNull();
  });

  it('CONTROL: a non-empty approved map is still kept unchanged', () => {
    saveFinalized({ um: 2 });
    expect(getSessionRecoveryDraft()?.metrics.fillerCounts).toEqual({ um: 2 });
  });

  it('CONTROL: an invalid map still fails the whole map closed (never a partial or fabricated {})', () => {
    saveFinalized({ um: 1, not_a_filler_key: 3 });
    expect(getSessionRecoveryDraft()?.metrics.fillerCounts).toBeUndefined();
  });

  it('CONTROL: a draft with no filler map at all stays without one (absent is not coerced to {})', () => {
    saveSessionRecoveryDraft({
      sessionId: 'session-none', userId: 'user-1', recoveryState: 'finalized_pending_save', durationSeconds: 90, mode: 'private',
      metrics: { totalWords: 180, wpm: 170 }, nextActionSignal,
    });
    expect(getSessionRecoveryDraft()?.metrics).not.toHaveProperty('fillerCounts');
  });
});
