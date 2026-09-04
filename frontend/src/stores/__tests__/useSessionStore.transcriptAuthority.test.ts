import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from '../useSessionStore';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { __resetTranscriptAuthorityForTests } from '@/services/telemetry/transcriptAuthority';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

/**
 * #1259 F05 — PROVED THROUGH THE REAL PRODUCER.
 *
 * `transcriptAuthority.test.ts` exercises the emitter, and passes whether or not anything calls it.
 * Finalization ends in NINE places in the controller, all of which funnel through this one setter —
 * which is why the setter, not those nine call sites, is the authority. These tests drive the real
 * store so that removing the emission from it fails something.
 */
describe('#1259 F05 — the store reports finalization at its single authority', () => {
    const pushSpy = vi.spyOn(analyticsBuffer, 'push');
    const rows = () => pushSpy.mock.calls
        .filter((c) => c[0] === 'transcript_authority')
        .map((c) => c[1] as Record<string, unknown>);

    beforeEach(() => {
        pushSpy.mockClear();
        __resetTranscriptAuthorityForTests();
        useSessionStore.setState({
            isTranscriptFinalizing: false,
            transcript: { transcript: '', partial: '' },
            sessionSaved: false,
            finalizedAnalysis: null,
        });
    });

    it('emits a finalize row when finalization ENDS, carrying the committed word count', () => {
        useSessionStore.getState().setTranscriptFinalizing(true);
        useSessionStore.setState({ transcript: { transcript: 'one two three four five', partial: '' } });
        expect(rows()).toHaveLength(0);   // nothing on entry — only the completion is the fact

        useSessionStore.getState().setTranscriptFinalizing(false);

        expect(rows()).toHaveLength(1);
        expect(rows()[0].stage).toBe('finalize');
        expect(rows()[0].authoritative_word_count).toBe(5);
    });

    it('does NOT emit when the flag is set false without ever having been true', () => {
        // Idempotent teardown calls it repeatedly; a row per call would be noise, and would report a
        // finalization that never happened.
        useSessionStore.getState().setTranscriptFinalizing(false);
        useSessionStore.getState().setTranscriptFinalizing(false);
        expect(rows()).toHaveLength(0);
    });

    it('reports an EMPTY authority honestly — the transcript vanishing is the finding', () => {
        useSessionStore.setState({ transcript: { transcript: 'some committed words here', partial: '' } });
        useSessionStore.getState().setTranscriptFinalizing(true);
        // Whatever purged it, the authority is empty by the time finalization ends.
        useSessionStore.setState({ transcript: { transcript: '', partial: '' } });
        useSessionStore.getState().setTranscriptFinalizing(false);

        expect(rows()[0].authoritative_word_count).toBe(0);
        expect(rows()[0].transcript_visibly_present).toBe(false);
    });

    it('reports the COMMITTED text, not the partial still in flux', () => {
        useSessionStore.getState().setTranscriptFinalizing(true);
        useSessionStore.setState({ transcript: { transcript: 'two words', partial: 'and some more interim text here' } });
        useSessionStore.getState().setTranscriptFinalizing(false);
        expect(rows()[0].authoritative_word_count).toBe(2);
    });

    it('still flips the flag — telemetry must not change store behaviour', () => {
        useSessionStore.getState().setTranscriptFinalizing(true);
        expect(useSessionStore.getState().isTranscriptFinalizing).toBe(true);
        useSessionStore.getState().setTranscriptFinalizing(false);
        expect(useSessionStore.getState().isTranscriptFinalizing).toBe(false);
    });
});
