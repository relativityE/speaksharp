import { describe, it, expect } from 'vitest';
import { shouldPublishFinalized } from '../finalizeGate';

const base = { formatterDone: true, metricsDone: true, metricsOk: true, tokenValid: true };

describe('shouldPublishFinalized — two-track terminal join', () => {
    it('publishes only when BOTH tracks are terminal, metrics ok, and token valid', () => {
        expect(shouldPublishFinalized(base)).toBe(true);
    });

    it('formatter terminal while metrics persistence is PENDING → no ready UI', () => {
        expect(shouldPublishFinalized({ ...base, metricsDone: false })).toBe(false);
    });

    it('metrics persistence terminal while formatter is PENDING → no ready UI', () => {
        expect(shouldPublishFinalized({ ...base, formatterDone: false })).toBe(false);
    });

    it('metrics persistence FAILED → no ready UI even when both tracks are terminal', () => {
        expect(shouldPublishFinalized({ ...base, metricsOk: false })).toBe(false);
    });

    it('stale finalize token (newer session) → never publishes', () => {
        expect(shouldPublishFinalized({ ...base, tokenValid: false })).toBe(false);
        // ...even if everything else is terminal + ok.
        expect(shouldPublishFinalized({ formatterDone: true, metricsDone: true, metricsOk: true, tokenValid: false })).toBe(false);
    });

    it('neither track done → no ready UI', () => {
        expect(shouldPublishFinalized({ formatterDone: false, metricsDone: false, metricsOk: false, tokenValid: true })).toBe(false);
    });
});
