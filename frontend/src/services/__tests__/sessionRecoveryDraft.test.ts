import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSessionRecoveryDraft,
  getLegacyOwnerlessDraft,
  getRecoverableDraftForUser,
  getSessionRecoveryDraft,
  saveSessionRecoveryDraft,
} from '@/services/sessionRecoveryDraft';

const RECOVERY_DRAFT_KEY = 'speaksharp_unsaved_session_draft';
const finalized = { um: 2 };

describe('sessionRecoveryDraft (content-free, #1306)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('stores and reads a CONTENT-FREE finalized draft (metrics + next action, no transcript)', () => {
    saveSessionRecoveryDraft({
      sessionId: 'session-1',
      userId: 'user-1',
      recoveryState: 'finalized_pending_save',
      durationSeconds: 42,
      mode: 'native',
      metrics: { totalWords: 120, wpm: 140, fillerCounts: finalized },
      nextActionSignal: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' },
    });

    const draft = getSessionRecoveryDraft();
    expect(draft).toEqual(expect.objectContaining({
      sessionId: 'session-1',
      userId: 'user-1',
      recoveryState: 'finalized_pending_save',
      durationSeconds: 42,
      mode: 'native',
    }));
    expect(draft?.metrics).toEqual({ totalWords: 120, wpm: 140, fillerCounts: finalized });
    expect(draft?.nextActionSignal?.actionCode).toBe('MAINTAIN');
    // Falsification: the stored draft type has no transcript field.
    expect(draft as unknown as { transcript?: unknown }).not.toHaveProperty('transcript');
  });

  it('an active_interrupted draft carries only partial counters and NEVER a next action', () => {
    saveSessionRecoveryDraft({
      sessionId: 's-int', userId: 'user-1', recoveryState: 'active_interrupted',
      durationSeconds: 8, mode: 'native', metrics: { totalWords: 12 },
      // A next action is invalid for an interrupted draft — the module must strip it.
      nextActionSignal: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' },
    });
    const draft = getSessionRecoveryDraft();
    expect(draft?.recoveryState).toBe('active_interrupted');
    expect(draft?.nextActionSignal ?? null).toBeNull();
  });

  it('does not store a draft with no elapsed time', () => {
    saveSessionRecoveryDraft({ sessionId: 's0', recoveryState: 'active_interrupted', durationSeconds: 0, mode: 'native', metrics: {} });
    expect(getSessionRecoveryDraft()).toBeNull();
  });

  // FALSIFICATION (storage API): a transcript can NEVER reach localStorage through the writer, even if a caller
  // smuggles one in via an untyped object.
  it('NEVER writes a transcript to localStorage even when a caller tries to smuggle one', () => {
    const sneaky = {
      sessionId: 's-sneaky', userId: 'user-1', recoveryState: 'finalized_pending_save' as const,
      durationSeconds: 30, mode: 'native' as const, metrics: { totalWords: 5 },
      transcript: 'um so today I talked about my weekend trip in detail',
    };
    saveSessionRecoveryDraft(sneaky as unknown as Parameters<typeof saveSessionRecoveryDraft>[0]);
    const raw = window.localStorage.getItem(RECOVERY_DRAFT_KEY) ?? '';
    expect(raw).not.toMatch(/weekend trip/);
    expect(raw).not.toMatch(/transcript/);
    expect(getSessionRecoveryDraft()).not.toHaveProperty('transcript');
  });

  // FALSIFICATION (recovery flow): a LEGACY transcript-bearing draft (written before #1306) is never honored,
  // AND it is physically DELETED on detection — refusing to load it would leave the transcript in localStorage.
  it('DELETES a legacy transcript-bearing draft on read (rejection + physical removal)', () => {
    window.localStorage.setItem(RECOVERY_DRAFT_KEY, JSON.stringify({
      sessionId: 's-legacy', userId: 'user-1', transcript: 'the exact words I said out loud', durationSeconds: 20, mode: 'native', savedAt: new Date(0).toISOString(),
    }));
    expect(getSessionRecoveryDraft()).toBeNull();                     // rejected
    expect(window.localStorage.getItem(RECOVERY_DRAFT_KEY)).toBeNull(); // AND physically removed
    expect(getRecoverableDraftForUser('user-1')).toBeNull();
  });

  it('DELETES a legacy draft that hides content under ai_suggestions/ground_truth', () => {
    window.localStorage.setItem(RECOVERY_DRAFT_KEY, JSON.stringify({
      sessionId: 's-legacy2', userId: 'user-1', recoveryState: 'finalized_pending_save', durationSeconds: 20, mode: 'native',
      ai_suggestions: { what_to_try_next: 'slow down when you said the part about the budget' }, savedAt: new Date(0).toISOString(),
    }));
    expect(getSessionRecoveryDraft()).toBeNull();
    expect(window.localStorage.getItem(RECOVERY_DRAFT_KEY)).toBeNull();
  });

  it('only clears matching drafts when a session id is provided', () => {
    saveSessionRecoveryDraft({ sessionId: 'session-1', recoveryState: 'finalized_pending_save', durationSeconds: 10, mode: 'private', metrics: { totalWords: 8 } });
    clearSessionRecoveryDraft('different-session');
    expect(getSessionRecoveryDraft()?.sessionId).toBe('session-1');
    clearSessionRecoveryDraft('session-1');
    expect(getSessionRecoveryDraft()).toBeNull();
  });

  // #1033 (C3) — account-boundary isolation for a single global draft key.
  it('getRecoverableDraftForUser returns the draft ONLY to its owner', () => {
    saveSessionRecoveryDraft({ sessionId: 's-A', userId: 'user-A', recoveryState: 'finalized_pending_save', durationSeconds: 12, mode: 'private', metrics: { totalWords: 10 } });
    expect(getRecoverableDraftForUser('user-A')?.sessionId).toBe('s-A');
    expect(getRecoverableDraftForUser('user-B')).toBeNull();
    expect(getRecoverableDraftForUser(null)).toBeNull();
  });

  it('getRecoverableDraftForUser NEVER returns a legacy ownerless draft; the explicit escape hatch does', () => {
    saveSessionRecoveryDraft({ sessionId: 's-legacy', recoveryState: 'active_interrupted', durationSeconds: 5, mode: 'private', metrics: { totalWords: 3 } });
    expect(getRecoverableDraftForUser('user-A')).toBeNull();
    expect(getRecoverableDraftForUser(null)).toBeNull();
    expect(getLegacyOwnerlessDraft()?.sessionId).toBe('s-legacy');
  });

  it('getLegacyOwnerlessDraft returns null when the stored draft IS owned', () => {
    saveSessionRecoveryDraft({ sessionId: 's-owned', userId: 'user-A', recoveryState: 'active_interrupted', durationSeconds: 5, mode: 'private', metrics: { totalWords: 3 } });
    expect(getLegacyOwnerlessDraft()).toBeNull();
  });

  // #1306 P1: structured metric fields in a draft must satisfy the SAME approved-key / fixed-key / strict-shape
  // contracts as the persistence boundary — at BOTH write and read — so no prose can enter localStorage or a
  // retry payload through filler keys, pause keys, or an unvalidated next-action object.
  describe('#1306 P1 — approved filler keys / fixed pause keys / strict next-action at write AND read', () => {
    it('drops the WHOLE filler map when any key is unknown/prose (fail closed at write)', () => {
      saveSessionRecoveryDraft({
        sessionId: 's-fk', userId: 'u1', recoveryState: 'finalized_pending_save', durationSeconds: 30, mode: 'private',
        metrics: { totalWords: 10, fillerCounts: { um: 3, 'confidential phrase': 1 } as unknown as Record<string, number> },
      });
      const raw = window.localStorage.getItem(RECOVERY_DRAFT_KEY) ?? '';
      expect(raw).not.toMatch(/confidential/i);
      expect(getSessionRecoveryDraft()?.metrics.fillerCounts).toBeUndefined(); // whole map dropped, not partial
    });

    it('drops filler counts that are fractional or over-limit (match the DB integer/range firewall)', () => {
      saveSessionRecoveryDraft({
        sessionId: 's-fk2', userId: 'u1', recoveryState: 'finalized_pending_save', durationSeconds: 30, mode: 'private',
        metrics: { totalWords: 10, fillerCounts: { um: 2.5 } },
      });
      expect(getSessionRecoveryDraft()?.metrics.fillerCounts).toBeUndefined();
      // a clean approved-integer map still survives
      window.localStorage.clear();
      saveSessionRecoveryDraft({
        sessionId: 's-fk3', userId: 'u1', recoveryState: 'finalized_pending_save', durationSeconds: 30, mode: 'private',
        metrics: { totalWords: 10, fillerCounts: { um: 3, like: 1 } },
      });
      expect(getSessionRecoveryDraft()?.metrics.fillerCounts).toEqual({ um: 3, like: 1 });
    });

    it('drops the WHOLE pause map when any key is not an approved aggregate field', () => {
      saveSessionRecoveryDraft({
        sessionId: 's-pk', userId: 'u1', recoveryState: 'finalized_pending_save', durationSeconds: 30, mode: 'private',
        metrics: { totalWords: 10, pauseMetrics: { totalPauses: 2, 'a whole sentence i said': 1 } as unknown as Record<string, number> },
      });
      const raw = window.localStorage.getItem(RECOVERY_DRAFT_KEY) ?? '';
      expect(raw).not.toMatch(/sentence i said/i);
      expect(getSessionRecoveryDraft()?.metrics.pauseMetrics).toBeUndefined();
      // a clean fixed-key pause map (floats allowed) survives
      window.localStorage.clear();
      saveSessionRecoveryDraft({
        sessionId: 's-pk2', userId: 'u1', recoveryState: 'finalized_pending_save', durationSeconds: 30, mode: 'private',
        metrics: { totalWords: 10, pauseMetrics: { totalPauses: 2, averagePauseDuration: 1.5 } },
      });
      expect(getSessionRecoveryDraft()?.metrics.pauseMetrics).toEqual({ totalPauses: 2, averagePauseDuration: 1.5 });
    });

    it('forces an invalid / prose-bearing next-action object to null at the WRITE boundary', () => {
      saveSessionRecoveryDraft({
        sessionId: 's-na', userId: 'u1', recoveryState: 'finalized_pending_save', durationSeconds: 30, mode: 'private',
        metrics: { totalWords: 10 },
        // reasonCode is free-form prose, not an enum — must be rejected, and never written.
        nextActionSignal: { reasonCode: 'You rambled about the merger for too long', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' } as unknown as Parameters<typeof saveSessionRecoveryDraft>[0]['nextActionSignal'],
      });
      const raw = window.localStorage.getItem(RECOVERY_DRAFT_KEY) ?? '';
      expect(raw).not.toMatch(/merger/i);
      expect(getSessionRecoveryDraft()?.nextActionSignal ?? null).toBeNull();
    });

    it('forces an invalid next-action object to null at the READ boundary (rogue/hand-edited localStorage)', () => {
      // A draft written by an older/rogue build with an unvalidated next action sitting in storage.
      window.localStorage.setItem(RECOVERY_DRAFT_KEY, JSON.stringify({
        sessionId: 's-na2', userId: 'u1', recoveryState: 'finalized_pending_save', durationSeconds: 30, mode: 'private',
        metrics: { totalWords: 10 },
        nextActionSignal: { reasonCode: 'HIGH_FILLER_RATE', freeform: 'slow down on the part about layoffs' },
        savedAt: new Date(0).toISOString(),
      }));
      const draft = getSessionRecoveryDraft();
      expect(draft?.nextActionSignal ?? null).toBeNull();               // invalid shape → dropped on read
      expect(JSON.stringify(draft)).not.toMatch(/layoffs/i);
    });

    it('a VALID strict next action still round-trips for a finalized draft', () => {
      const good = { reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate', value: 8, comparator: 'above_target', templateVersion: 'rec_v1' } as const;
      saveSessionRecoveryDraft({
        sessionId: 's-na3', userId: 'u1', recoveryState: 'finalized_pending_save', durationSeconds: 30, mode: 'private',
        metrics: { totalWords: 10 }, nextActionSignal: good,
      });
      expect(getSessionRecoveryDraft()?.nextActionSignal).toEqual(good);
      expect(getSessionRecoveryDraft()?.recoveryState).toBe('finalized_pending_save'); // stays replayable
    });

    it('WRITE downgrades a finalized draft with NO valid next action to active_interrupted (never a completed session)', () => {
      saveSessionRecoveryDraft({
        sessionId: 's-dg1', userId: 'u1', recoveryState: 'finalized_pending_save', durationSeconds: 30, mode: 'private',
        metrics: { totalWords: 10 }, // no nextActionSignal
      });
      const draft = getSessionRecoveryDraft();
      expect(draft?.recoveryState).toBe('active_interrupted'); // write-time downgrade (safe)
      expect(draft?.nextActionSignal ?? null).toBeNull();
    });

    it('READ deletes + returns null for a MALFORMED finalized draft (never reinterpreted as interrupted)', () => {
      // A rogue/legacy/hand-edited draft claiming finalized completion but with an INVALID next action in raw
      // storage must be physically removed and read as null — not downgraded.
      window.localStorage.setItem(RECOVERY_DRAFT_KEY, JSON.stringify({
        sessionId: 's-dg2', userId: 'u1', recoveryState: 'finalized_pending_save', durationSeconds: 30, mode: 'private',
        metrics: { totalWords: 10 },
        nextActionSignal: { reasonCode: 'ramble about the layoffs', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' },
        savedAt: new Date(0).toISOString(),
      }));
      expect(getSessionRecoveryDraft()).toBeNull();                       // not replayable, returns null
      expect(window.localStorage.getItem(RECOVERY_DRAFT_KEY)).toBeNull(); // AND physically deleted
    });
  });
});
