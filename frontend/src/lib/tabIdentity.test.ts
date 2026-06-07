import { describe, it, expect, beforeEach } from 'vitest';
import { getStableTabId } from './tabIdentity';

describe('getStableTabId', () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    it('returns a stable id across calls within the same tab and persists it to sessionStorage', () => {
        const first = getStableTabId();
        const second = getStableTabId();
        expect(first).toBe(second);
        expect(sessionStorage.getItem('speaksharp_tab_id')).toBe(first);
    });

    it('reuses an existing sessionStorage id (survives reload within the tab)', () => {
        sessionStorage.setItem('speaksharp_tab_id', 'preset-tab-id');
        expect(getStableTabId()).toBe('preset-tab-id');
    });

    it('a fresh sessionStorage (different/closed tab) yields a different id', () => {
        const a = getStableTabId();
        sessionStorage.clear();
        const b = getStableTabId();
        expect(b).not.toBe(a);
    });
});
