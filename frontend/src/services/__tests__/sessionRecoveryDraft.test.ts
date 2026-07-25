import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSessionRecoveryDraft,
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

  it('getRecoverableDraftForUser matches a legacy no-user draft only for an anonymous caller', () => {
    saveSessionRecoveryDraft({ sessionId: 's-legacy', transcript: 'pre-userId draft', durationSeconds: 5, mode: 'private' });
    expect(getRecoverableDraftForUser(null)?.sessionId).toBe('s-legacy'); // no owner ↔ no current user
    expect(getRecoverableDraftForUser('user-A')).toBeNull(); // a real user does not adopt an ownerless draft
  });
});
