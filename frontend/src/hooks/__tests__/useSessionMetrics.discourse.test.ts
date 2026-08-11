/* @vitest-environment jsdom */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSessionMetrics } from '../useSessionMetrics';
import type { FillerCounts } from '@/utils/fillerWordUtils';

// #1231 filler slice 2 — the discourse-marker opt-in changes the TIER DEFINITION of the headline count
// (which keys are summed), derived from the SAME live per-key fillerData. Default off = true fillers only.
describe('useSessionMetrics — discourse-marker opt-in (#1231)', () => {
    // 2 true fillers (um) + 3 discourse markers (like). No user words.
    const fillerData = { um: { count: 2 }, like: { count: 3 } } as unknown as FillerCounts;
    const base = { transcript: 'a b c d e f g h i j', chunks: [], elapsedTime: 60, fillerData };

    it('defaults OFF: headline counts true fillers only (discourse markers excluded)', () => {
        const { result } = renderHook(() => useSessionMetrics(base));
        expect(result.current.fillerCount).toBe(2);
    });

    it('OFF explicitly matches the default', () => {
        const { result } = renderHook(() => useSessionMetrics({ ...base, includeDiscourseMarkers: false }));
        expect(result.current.fillerCount).toBe(2);
    });

    it('ON: discourse markers are added to the headline (2 true + 3 discourse = 5)', () => {
        const { result } = renderHook(() => useSessionMetrics({ ...base, includeDiscourseMarkers: true }));
        expect(result.current.fillerCount).toBe(5);
    });

    it('the detail rows (fillerData) are unchanged by the pref — only the counted total moves', () => {
        const off = renderHook(() => useSessionMetrics({ ...base, includeDiscourseMarkers: false }));
        const on = renderHook(() => useSessionMetrics({ ...base, includeDiscourseMarkers: true }));
        expect(off.result.current.fillerData).toEqual(on.result.current.fillerData);
        expect(off.result.current.fillerData).toBe(fillerData);
    });
});
