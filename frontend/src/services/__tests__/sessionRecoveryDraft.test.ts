import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSessionRecoveryDraft,
  getLegacyOwnerlessDraft,
  getRecoverableDraftForUser,
  getSessionRecoveryDraft,
  saveSessionRecoveryDraft,
} from '@/services/sessionRecoveryDraft';

describe('sessionRecoveryDraft', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('stores and reads an unsaved session draft', () => {
    saveSessionRecoveryDraft({
      sessionId: 'session-1',
      userId: 'user-1',
      transcript: 'Today I want to give a clear update.',
      durationSeconds: 42,
      mode: 'native',
    });

    expect(getSessionRecoveryDraft()).toEqual(expect.objectContaining({
      sessionId: 'session-1',
      userId: 'user-1',
      transcript: 'Today I want to give a clear update.',
      durationSeconds: 42,
      mode: 'native',
    }));
  });

  it('does not store empty transcripts', () => {
    saveSessionRecoveryDraft({
      sessionId: 'session-empty',
      transcript: '   ',
      durationSeconds: 0,
      mode: 'native',
    });

    expect(getSessionRecoveryDraft()).toBeNull();
  });

  it('only clears matching drafts when a session id is provided', () => {
    saveSessionRecoveryDraft({
      sessionId: 'session-1',
      transcript: 'Recovered transcript.',
      durationSeconds: 10,
      mode: 'private',
    });

    clearSessionRecoveryDraft('different-session');
    expect(getSessionRecoveryDraft()?.sessionId).toBe('session-1');

    clearSessionRecoveryDraft('session-1');
    expect(getSessionRecoveryDraft()).toBeNull();
  });

  // #1033 (C3) — account-boundary isolation for a single global draft key.
  it('getRecoverableDraftForUser returns the draft ONLY to its owner', () => {
    saveSessionRecoveryDraft({ sessionId: 's-A', userId: 'user-A', transcript: 'A private words', durationSeconds: 12, mode: 'private' });
    expect(getRecoverableDraftForUser('user-A')?.sessionId).toBe('s-A'); // owner
    expect(getRecoverableDraftForUser('user-B')).toBeNull(); // different user — never exposed
    expect(getRecoverableDraftForUser(null)).toBeNull(); // anonymous cannot read a user's draft
  });

  // #1033 (1) — a LEGACY ownerless draft has unknown provenance (it may have been written by a previously
  // signed-in user of this browser), so it is never auto-adopted by anyone — only reachable explicitly.
  it('getRecoverableDraftForUser NEVER returns a legacy ownerless draft; the explicit escape hatch does', () => {
    saveSessionRecoveryDraft({ sessionId: 's-legacy', transcript: 'pre-userId draft', durationSeconds: 5, mode: 'private' });
    expect(getRecoverableDraftForUser('user-A')).toBeNull(); // a real user never adopts an ownerless draft
    expect(getRecoverableDraftForUser(null)).toBeNull();     // nor does an anonymous caller
    expect(getLegacyOwnerlessDraft()?.sessionId).toBe('s-legacy'); // explicit, user-confirmed handling only
  });

  it('getLegacyOwnerlessDraft returns null when the stored draft IS owned', () => {
    saveSessionRecoveryDraft({ sessionId: 's-owned', userId: 'user-A', transcript: 'owned', durationSeconds: 5, mode: 'private' });
    expect(getLegacyOwnerlessDraft()).toBeNull();
  });
});
