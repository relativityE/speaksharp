import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MicCard } from '../MicCard';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

/**
 * #1259 F03 — PROVED THROUGH THE REAL CONTROL.
 *
 * `journeyStep.test.ts` exercises the emitter and passes whether or not this component calls it, so
 * removing the emission from `MicCard` left it green. F03 is a claim about two SPECIFIC controls; a
 * test that never renders either of them cannot support it.
 */
describe('#1259 F03 — the mic control reports its identity and its real action', () => {
    // Replaced rather than called through: this asserts WHICH event the control produces, and letting
    // the real buffer run would drag its transport, envelope and scheduling into a component test that
    // has no business exercising them.
    const pushSpy = vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => {});
    const steps = () => pushSpy.mock.calls
        .filter((c) => c[0] === 'journey_step')
        .map((c) => c[1] as Record<string, unknown>);

    beforeEach(() => pushSpy.mockClear());

    it('the START control reports start_recording — not navigate', () => {
        const onStart = vi.fn();
        render(<MicCard onStart={onStart} privateModelStatus="ready" />);
        fireEvent.click(screen.getByTestId('mic-start'));

        expect(steps()).toHaveLength(1);
        expect(steps()[0].cta_id).toBe('mic_card_primary');
        // The other "start speaking" — the Focus Points setup CTA — reports `navigate`. Same words to
        // the user, different recorded action, which is the whole of F03.
        expect(steps()[0].cta_action).toBe('start_recording');
        expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('a COLD start reports a recording start, because that is what the press now does', () => {
        // This asserted `mic_card_setup` / `submit` / `onDownloadModel`, which was the truth when the
        // cold control ONLY downloaded and a second press was needed to record. #1416 made the cold
        // press one activation that consents, prepares AND records, routing through `onStart`.
        // Telemetry that still called it a setup submit would report a two-click journey that no
        // longer exists — and F-01 is precisely a question about how many presses a start takes.
        const onStart = vi.fn();
        const onDownloadModel = vi.fn();
        render(
            <MicCard onStart={onStart} onDownloadModel={onDownloadModel} privateModelStatus="download-required" />,
        );
        fireEvent.click(screen.getByTestId('mic-download'));

        expect(steps()[0].cta_id).toBe('mic_card_primary');
        expect(steps()[0].cta_action).toBe('start_recording');
        expect(onStart).toHaveBeenCalledTimes(1);
        expect(onDownloadModel).not.toHaveBeenCalled();
    });

    it('the RETRY branch is the one that still reports a setup submit', () => {
        // A failed setup keeps its own action: retrying a broken engine records nothing, so it is
        // genuinely a submit and must stay distinguishable from a start in the journey.
        const onStart = vi.fn();
        const onDownloadModel = vi.fn();
        render(
            <MicCard onStart={onStart} onDownloadModel={onDownloadModel} privateModelStatus="init-failed" />,
        );
        fireEvent.click(screen.getByTestId('mic-retry'));

        expect(steps()[0].cta_id).toBe('mic_card_setup');
        expect(steps()[0].cta_action).toBe('submit');
        expect(onDownloadModel).toHaveBeenCalledTimes(1);
        expect(onStart).not.toHaveBeenCalled();
    });

    it('telemetry does not swallow the click — the control still works', () => {
        // Wrapping a handler is the easiest way to break the product while the telemetry looks fine.
        const onStart = vi.fn();
        render(<MicCard onStart={onStart} privateModelStatus="ready" />);
        fireEvent.click(screen.getByTestId('mic-start'));
        fireEvent.click(screen.getByTestId('mic-start'));
        expect(onStart).toHaveBeenCalledTimes(2);
        expect(steps()).toHaveLength(2);
    });
});
