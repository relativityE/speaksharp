/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MicCard } from '../MicCard';
import {
    MIC_CONTROL_BY_STATUS, NON_ACTIONABLE_STATUS, RETIRED_COMBINED_CONTROL, micControlFor,
} from '../../../../../tests/helpers/micControls';

/**
 * #1306 — RENDERED-STATE contract for the desktop `before` slot.
 *
 * WHY THIS EXISTS. The production proof clicked `session-start-stop-button` to start a first-run model
 * download. No component renders that id — MicCard renders a state-specific testid, and MobileActionBar
 * renders the SUFFIXED `-mobile` variant. The proof waited 40 minutes for a control that cannot exist,
 * never invoked acquisition, and reported the model as stuck.
 *
 * The check that was supposed to prevent this asserted the selector existed IN SOURCE. It does exist —
 * as a constant, referenced from a .tsx — so the check passed while the harness was broken. That is a
 * frame error: it tested something adjacent to the claim. Only rendering the component in the state and
 * asserting what appears can catch it.
 *
 * These tests are also what PINS `tests/helpers/micControls.ts` to reality. The live Playwright helpers
 * build every locator from that map, so an entry that drifts from the component fails here.
 */
const baseProps = { onStart: vi.fn(), onDownloadModel: vi.fn() };

const ALL_PRIMARY = ['mic-download', 'mic-retry', 'mic-start'] as const;

const renderIn = (privateModelStatus: string) => {
    const onStart = vi.fn();
    const onDownloadModel = vi.fn();
    render(
        <MicCard
            {...baseProps}
            onStart={onStart}
            onDownloadModel={onDownloadModel}
            privateModelStatus={privateModelStatus}
        />,
    );
    return { onStart, onDownloadModel };
};

describe('MicCard — rendered state to control mapping', () => {
    it.each([
        // #1415 — the cold control is still `mic-download` (it DOES download), but the press is now
        // one activation that consents, prepares and records, so it invokes the recording intent.
        // It previously invoked `onDownloadModel` and stopped there, which is the two-click failure.
        ['download-required', 'mic-download', 'onStart'],
        ['init-failed', 'mic-retry', 'onDownloadModel'],
        ['error', 'mic-retry', 'onDownloadModel'],
        ['ready', 'mic-start', 'onStart'],
        ['idle', 'mic-start', 'onStart'],
    ] as const)('%s renders exactly one enabled %s and clicking it invokes %s once', (status, control, handler) => {
        // The map is the harness's only source of selectors, so it must agree with the component.
        expect(micControlFor(status), `map entry for ${status}`).toBe(control);

        const { onStart, onDownloadModel } = renderIn(status);

        const matches = screen.getAllByTestId(control);
        expect(matches, `${status} must render exactly one ${control}`).toHaveLength(1);
        expect(matches[0]).toBeEnabled();

        // Mutual exclusion: a page showing two primary controls is not in a single known state.
        for (const other of ALL_PRIMARY.filter((c) => c !== control)) {
            expect(screen.queryByTestId(other), `${status} must not render ${other}`).not.toBeInTheDocument();
        }
        // The control the proof used to click is rendered by nothing, in any state.
        expect(screen.queryByTestId(RETIRED_COMBINED_CONTROL)).not.toBeInTheDocument();

        fireEvent.click(matches[0]);
        const [called, notCalled] = handler === 'onStart' ? [onStart, onDownloadModel] : [onDownloadModel, onStart];
        expect(called, `${status} must invoke ${handler}`).toHaveBeenCalledTimes(1);
        expect(notCalled, `${status} must not invoke the other handler`).not.toHaveBeenCalled();
    });

    it('loading is non-actionable — the control is disabled and invokes nothing', () => {
        // The mic is greyed out for the whole download; the map returns no control for this state, so a
        // harness that tried to act here would fail loudly instead of clicking a dead button.
        expect(micControlFor(NON_ACTIONABLE_STATUS)).toBeNull();
        const { onStart, onDownloadModel } = renderIn(NON_ACTIONABLE_STATUS);
        const control = screen.getByTestId('mic-start');
        expect(control).toBeDisabled();
        fireEvent.click(control);
        expect(onStart).not.toHaveBeenCalled();
        expect(onDownloadModel).not.toHaveBeenCalled();
    });

    it('every mapped status is reachable and the map has no entry the component cannot render', () => {
        // Guards the other direction: an invented map entry (or a renamed testid) fails here rather
        // than during a production dispatch.
        for (const [status, control] of Object.entries(MIC_CONTROL_BY_STATUS)) {
            renderIn(status);
            expect(screen.queryAllByTestId(control), `${status} -> ${control}`).toHaveLength(1);
            cleanup();
        }
    });

    it('a setup failure never leaves a permanently-disabled control (#1258)', () => {
        for (const failed of ['init-failed', 'error']) {
            renderIn(failed);
            expect(screen.getByTestId('mic-retry'), `${failed} retry must stay clickable`).toBeEnabled();
            cleanup();
        }
    });
});
