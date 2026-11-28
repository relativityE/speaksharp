import { describe, it, expect } from 'vitest';
import { createTestSessionStore } from './storeFactory';

/**
 * The test store mirrors the real store's Focus Points detection field (#1995): it starts empty, is set with the
 * coverage result, and defaults to null when a caller (the flag-off path) passes no detection.
 */
describe('createTestSessionStore objective coverage detection', () => {
    it('starts with no detection and records the one passed with the coverage result', () => {
        const store = createTestSessionStore();
        expect(store.getState().objectiveCoverageDetection).toBeNull();
        store.getState().setObjectiveCoverageResult(null as never, { engine: 'nli' } as never);
        expect(store.getState().objectiveCoverageDetection).toEqual({ engine: 'nli' });
        expect(store.getState().objectiveCoverageFailed).toBe(false);
    });

    it('a coverage result without detection (flag off) leaves detection null', () => {
        const store = createTestSessionStore({ objectiveCoverageDetection: { engine: 'keyword' } as never });
        store.getState().setObjectiveCoverageResult(null as never);
        expect(store.getState().objectiveCoverageDetection).toBeNull();
    });
});
