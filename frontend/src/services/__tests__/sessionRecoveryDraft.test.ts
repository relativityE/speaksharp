import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSessionRecoveryDraft,
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
});
