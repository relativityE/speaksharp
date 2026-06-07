import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveSessionRecoveryDraft,
  getSessionRecoveryDraft,
  clearSessionRecoveryDraft,
} from '../sessionRecoveryDraft';

/**
 * UX-NAV-1 — deterministic tab-close / hard-navigation recovery contract.
 *
 * The live tab-close proof is flaky because injected-audio timing means a Private recording often has
 * NO visible transcript yet at the moment of close (nothing to recover — a documented by-design
 * limitation: in-memory audio before stop is unrecoverable). This test proves the RECOVERY CONTRACT
 * deterministically, without STT: a draft persisted on unload is restored on the next load, a normal
 * stop+save clears it (no resurrection), and there is nothing to recover when there was no text.
 */
describe('UX-NAV-1 tab-close recovery contract (deterministic)', () => {
  beforeEach(() => window.localStorage.clear());

  it('persisted-on-unload draft is restored on reopen (the tab-close journey)', () => {
    // App.tsx persists this synchronously on beforeunload/pagehide/visibilitychange while recording.
    saveSessionRecoveryDraft({
      sessionId: 's-1',
      userId: 'u-1',
      transcript: 'partial words captured before the tab closed',
      durationSeconds: 12,
      mode: 'native',
    });

    // Next page load (reopen) — SessionPage's recovery effect reads this.
    const restored = getSessionRecoveryDraft();
    expect(restored).not.toBeNull();
    expect(restored?.sessionId).toBe('s-1');
    expect(restored?.transcript).toBe('partial words captured before the tab closed');
    expect(restored?.mode).toBe('native');
    expect(restored?.durationSeconds).toBe(12);
    expect(typeof restored?.savedAt).toBe('string');
  });

  it('a normal stop+save clears the draft so it never resurrects a saved session', () => {
    saveSessionRecoveryDraft({ sessionId: 's-2', transcript: 'something', durationSeconds: 3, mode: 'native' });
    clearSessionRecoveryDraft('s-2');
    expect(getSessionRecoveryDraft()).toBeNull();
  });

  it('clear is scoped: a draft for a DIFFERENT session is not wiped', () => {
    saveSessionRecoveryDraft({ sessionId: 's-keep', transcript: 'keep me', durationSeconds: 5, mode: 'native' });
    clearSessionRecoveryDraft('s-other');
    expect(getSessionRecoveryDraft()?.sessionId).toBe('s-keep');
  });

  it('no text => nothing persisted (documented mid-recording-before-stop limitation)', () => {
    saveSessionRecoveryDraft({ sessionId: 's-3', transcript: '   ', durationSeconds: 8, mode: 'private' });
    expect(getSessionRecoveryDraft()).toBeNull();
  });

  it('a corrupt/partial payload is ignored safely (no crash, no false recovery)', () => {
    window.localStorage.setItem('speaksharp_unsaved_session_draft', '{not json');
    expect(getSessionRecoveryDraft()).toBeNull();
    window.localStorage.setItem('speaksharp_unsaved_session_draft', JSON.stringify({ durationSeconds: 1 }));
    expect(getSessionRecoveryDraft()).toBeNull(); // missing sessionId/transcript
  });
});
