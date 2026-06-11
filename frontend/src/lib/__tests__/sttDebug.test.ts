import { describe, it, expect } from 'vitest';
import { isSttDebugEnabled } from '../sttDebug';

function fakeWin(opts: { search?: string; flag?: boolean; ls?: Record<string, string> }): Window {
    const store = opts.ls ?? {};
    return {
        location: { search: opts.search ?? '' },
        localStorage: { getItem: (k: string) => (k in store ? store[k] : null) },
        ...(opts.flag !== undefined ? { __STT_DEBUG__: opts.flag } : {}),
    } as unknown as Window;
}

describe('isSttDebugEnabled', () => {
    it('off by default (no flag, no query, no storage)', () => {
        expect(isSttDebugEnabled(fakeWin({}))).toBe(false);
    });

    it('on via ?sttDebug=1 and ?sttDebug=true', () => {
        expect(isSttDebugEnabled(fakeWin({ search: '?sttDebug=1' }))).toBe(true);
        expect(isSttDebugEnabled(fakeWin({ search: '?sttDebug=true' }))).toBe(true);
    });

    it('off for other query values', () => {
        expect(isSttDebugEnabled(fakeWin({ search: '?sttDebug=0' }))).toBe(false);
        expect(isSttDebugEnabled(fakeWin({ search: '?other=1' }))).toBe(false);
    });

    it('on via window.__STT_DEBUG__ === true', () => {
        expect(isSttDebugEnabled(fakeWin({ flag: true }))).toBe(true);
        expect(isSttDebugEnabled(fakeWin({ flag: false }))).toBe(false);
    });

    it('on via localStorage flag', () => {
        expect(isSttDebugEnabled(fakeWin({ ls: { speaksharp_stt_debug: '1' } }))).toBe(true);
        expect(isSttDebugEnabled(fakeWin({ ls: { speaksharp_stt_debug: '0' } }))).toBe(false);
    });

    it('returns false when window is undefined', () => {
        expect(isSttDebugEnabled(undefined)).toBe(false);
    });
});
