import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveSessionRecoveryDraft,
  getSessionRecoveryDraft,
  clearSessionRecoveryDraft,
} from '../sessionRecoveryDraft';

/**
 * UX-NAV-1 — deterministic tab-close / hard-navigation recovery contract (#1306 content-free).
 *
 * On beforeunload/pagehide the app can only capture PARTIAL synchronous counters, never a transcript. This
 * proves the CONTENT-FREE recovery contract: an `active_interrupted` snapshot persisted on unload is restored
 * on reopen (with metrics only, no transcript), a normal stop+save clears it (no resurrection), and there is
 * nothing to recover when no time elapsed.
 */
describe('UX-NAV-1 tab-close recovery contract (content-free, deterministic)', () => {
  beforeEach(() => window.localStorage.clear());

  it('persisted-on-unload interrupted snapshot is restored on reopen (metrics only, no transcript)', () => {
    // App.tsx persists this synchronously on beforeunload/pagehide/visibilitychange while recording.
    saveSessionRecoveryDraft({
      sessionId: 's-1',
      userId: 'u-1',
      recoveryState: 'active_interrupted',
      durationSeconds: 12,
      mode: 'native',
      metrics: { totalWords: 7 },
    });

    const restored = getSessionRecoveryDraft();
    expect(restored).not.toBeNull();
    expect(restored?.sessionId).toBe('s-1');
    expect(restored?.recoveryState).toBe('active_interrupted');
    expect(restored?.metrics.totalWords).toBe(7);
    expect(restored).not.toHaveProperty('transcript');
    expect(restored?.mode).toBe('native');
    expect(restored?.durationSeconds).toBe(12);
    expect(typeof restored?.savedAt).toBe('string');
  });

  it('a normal stop+save clears the draft so it never resurrects a saved session', () => {
    saveSessionRecoveryDraft({ sessionId: 's-2', recoveryState: 'active_interrupted', durationSeconds: 3, mode: 'native', metrics: { totalWords: 1 } });
    clearSessionRecoveryDraft('s-2');
    expect(getSessionRecoveryDraft()).toBeNull();
  });

  it('clear is scoped: a draft for a DIFFERENT session is not wiped', () => {
    saveSessionRecoveryDraft({ sessionId: 's-keep', recoveryState: 'active_interrupted', durationSeconds: 5, mode: 'native', metrics: { totalWords: 2 } });
    clearSessionRecoveryDraft('s-other');
    expect(getSessionRecoveryDraft()?.sessionId).toBe('s-keep');
  });

  it('no elapsed time => nothing persisted (documented mid-recording-before-stop limitation)', () => {
    saveSessionRecoveryDraft({ sessionId: 's-3', recoveryState: 'active_interrupted', durationSeconds: 0, mode: 'private', metrics: {} });
    expect(getSessionRecoveryDraft()).toBeNull();
  });

  it('a corrupt/partial payload is ignored safely (no crash, no false recovery)', () => {
    window.localStorage.setItem('speaksharp_unsaved_session_draft', '{not json');
    expect(getSessionRecoveryDraft()).toBeNull();
    window.localStorage.setItem('speaksharp_unsaved_session_draft', JSON.stringify({ durationSeconds: 1 }));
    expect(getSessionRecoveryDraft()).toBeNull(); // missing sessionId/recoveryState
  });
});
