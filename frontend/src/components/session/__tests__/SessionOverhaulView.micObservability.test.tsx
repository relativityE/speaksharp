import { render } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionOverhaulView, type SessionOverhaulViewProps } from '../SessionOverhaulView';
import type { SttStatus } from '@/types/transcription';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

const base: SessionOverhaulViewProps = {
    authUserId: 'user-1',
    isListening: false,
    sttStatus: { type: 'idle' } as SttStatus,
    elapsedTime: 0,
    micLevel: 0,
    transcriptContent: '',
    showAnalyticsPrompt: false,
    metricsFillerCount: 0,
    onStartStop: vi.fn(),
    history: [],
};

/**
 * #1259 F02 — PROVED THROUGH THE REAL VIEW.
 *
 * `micObservation.test.ts` exercises the summariser and passes whether or not this component calls it,
 * and whether or not the Stop-affordance latch is set while recording. Both are producer links, and
 * both are exactly the kind of wiring that silently disappears.
 */
describe('#1259 F02 — the view summarises its own envelope', () => {
    const pushSpy = vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => {});
    const mic = () => pushSpy.mock.calls
        .filter((c) => c[0] === 'mic_observability')
        .map((c) => c[1] as Record<string, unknown>);

    beforeEach(() => pushSpy.mockClear());

    it('emits once when the session settles, not while recording', () => {
        const { rerender } = render(<SessionOverhaulView {...base} isListening micLevel={0.4} />);
        expect(mic()).toHaveLength(0);   // nothing during the take — no per-frame stream

        rerender(<SessionOverhaulView {...base} showAnalyticsPrompt transcriptContent="hello" />);
        expect(mic()).toHaveLength(1);
    });

    it('records that a Stop affordance WAS on screen during the take', () => {
        const { rerender } = render(<SessionOverhaulView {...base} isListening micLevel={0.4} />);
        rerender(<SessionOverhaulView {...base} showAnalyticsPrompt transcriptContent="hello" />);
        // Latched during recording, because by review time the control is gone — asking then would
        // report every session as missing its Stop button.
        expect(mic()[0].stop_control_rendered).toBe(true);
    });

    it('a session that never recorded reports NO stop affordance and no samples', () => {
        render(<SessionOverhaulView {...base} showAnalyticsPrompt transcriptContent="hello" />);
        expect(mic()[0].stop_control_rendered).toBe(false);
        expect(mic()[0].waveform_observability).toBe('unobservable');
    });

    it('a FLAT meter through a real take reports partial, not unobservable', () => {
        const { rerender } = render(<SessionOverhaulView {...base} isListening micLevel={0} />);
        rerender(<SessionOverhaulView {...base} isListening micLevel={0} />);
        rerender(<SessionOverhaulView {...base} showAnalyticsPrompt transcriptContent="hello" />);
        // Samples arrived and none carried signal — a dead meter, not an unmeasured session.
        expect(mic()[0].waveform_observability).toBe('partial');
        expect(mic()[0].signal_available).toBe(false);
    });
});

describe('#1421 P1 `3979074340` — each attempt reports its own microphone evidence', () => {
    // The describe above already spies on `push`. A second `vi.spyOn` would wrap that spy and silence its
    // recordings, so this block reads the same spy rather than installing another.
    const pushSpy = vi.mocked(analyticsBuffer.push);
    const mic = () => pushSpy.mock.calls
        .filter((c) => c[0] === 'mic_observability')
        .map((c) => c[1] as Record<string, unknown>);

    beforeEach(() => pushSpy.mockClear());

    it("CASUALTY: a direct Retry (after → during) does not inherit the first take's signal", () => {
        const { rerender } = render(<SessionOverhaulView {...base} isListening micLevel={0.4} />);
        rerender(<SessionOverhaulView {...base} showAnalyticsPrompt transcriptContent="hello" />);
        expect(mic()[0].signal_available, 'the first take had signal').toBe(true);

        // Retry straight from the review: the review prompt is still up, and a flat meter feeds the new take.
        rerender(<SessionOverhaulView {...base} showAnalyticsPrompt isListening micLevel={0} />);
        rerender(<SessionOverhaulView {...base} showAnalyticsPrompt isListening micLevel={0} />);
        rerender(<SessionOverhaulView {...base} showAnalyticsPrompt transcriptContent="hello again" />);

        expect(mic()).toHaveLength(2);
        expect(mic()[1].signal_available, "the retry's flat meter is its own evidence").toBe(false);
        expect(mic()[1].waveform_observability).toBe('partial');
        expect(mic()[1].stop_control_rendered, 'the retry did show its own Stop control').toBe(true);
    });

    it('CONTROL: an ordinary next take (before → during) also starts from empty evidence', () => {
        const { rerender } = render(<SessionOverhaulView {...base} isListening micLevel={0.4} />);
        rerender(<SessionOverhaulView {...base} showAnalyticsPrompt transcriptContent="hello" />);
        rerender(<SessionOverhaulView {...base} />);
        rerender(<SessionOverhaulView {...base} isListening micLevel={0} />);
        rerender(<SessionOverhaulView {...base} showAnalyticsPrompt transcriptContent="second" />);

        expect(mic()).toHaveLength(2);
        expect(mic()[0].signal_available).toBe(true);
        expect(mic()[1].signal_available).toBe(false);
    });

    it('CONTROL: a single take keeps its own samples and Stop latch from during through review', () => {
        const { rerender } = render(<SessionOverhaulView {...base} isListening micLevel={0.4} />);
        rerender(<SessionOverhaulView {...base} isListening micLevel={0.5} />);
        rerender(<SessionOverhaulView {...base} showAnalyticsPrompt transcriptContent="hello" />);
        expect(mic()[0]).toMatchObject({ signal_available: true, stop_control_rendered: true });
    });
});
