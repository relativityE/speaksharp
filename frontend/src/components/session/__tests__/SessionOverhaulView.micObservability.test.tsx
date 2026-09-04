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
