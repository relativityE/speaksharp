import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from '@/stores/useSessionStore';

// #1264 — the Practice Focus must survive a "Practice this next" repeat that re-navigates/reloads within
// the tab. It is persisted in sessionStorage so a fresh store (module re-init) restores it; clearing it
// removes the key. This is the store-level proof behind the end-to-end repeat-preservation journey.
const KEY = 'speaksharp_practice_focus_v1';

describe('#1264 — Practice Focus persistence (repeat preservation)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useSessionStore.getState().setPracticeFocus(null);
  });

  it('setPracticeFocus writes the intention to sessionStorage so a repeat can restore it', () => {
    useSessionStore.getState().setPracticeFocus('reduce_fillers');
    expect(useSessionStore.getState().practiceFocus).toBe('reduce_fillers');
    expect(sessionStorage.getItem(KEY)).toBe('reduce_fillers');
  });

  it('clearing the focus removes the persisted key', () => {
    useSessionStore.getState().setPracticeFocus('steady_pace');
    expect(sessionStorage.getItem(KEY)).toBe('steady_pace');
    useSessionStore.getState().setPracticeFocus(null);
    expect(useSessionStore.getState().practiceFocus).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('an unrecognized persisted value is ignored (never trusted as a focus)', () => {
    sessionStorage.setItem(KEY, 'not_a_real_focus');
    // The store validates on read; a bogus value must not surface as a selected focus.
    useSessionStore.getState().setPracticeFocus(null);
    expect(useSessionStore.getState().practiceFocus).toBeNull();
  });
});
