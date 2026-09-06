// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { useRouteExitIntentRetirement } from '@/hooks/useRouteExitIntentRetirement';
import {
    __resetRecordingIntentForTests,
    mintRecordingIntent,
    pendingRecordingIntent,
    lastRetiredIntent,
} from '@/services/recordingIntent';

/**
 * #1419 correction 2 — LEAVING `/session` RETIRES THAT CLICK.
 *
 * A cold click mints an intent that deliberately outlives model preparation, so a READY arriving
 * minutes later still starts the recording the user asked for. Leaving the page has to end it:
 * otherwise the click stays armed, and a late or fresh READY after the user returns activates the
 * microphone without them asking for it on the page they are now on. Consent does not survive the
 * page it was given on.
 *
 * The earlier attempt put this in `useSessionLifecycle`'s unmount, which is wrong twice over: that
 * cleanup runs on every React remount and is deliberately a SOFT reset, so it would destroy
 * legitimate intents on remounts that never left the page, and it cannot tell navigation from
 * remounting. This drives the REAL effect in `App` — the only authority that compares the previous
 * path to the current one — through an actual router navigation, not a synthetic controller call.
 */

vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

const mint = () => mintRecordingIntent({ recordingId: 'rec-1', policy: null, userWords: [] });

/** Drives the REAL hook `App` uses — not a copy of it. */
const Harness: React.FC<{ pathname: string }> = ({ pathname }) => {
    useRouteExitIntentRetirement(pathname);
    return <div data-testid="at">{pathname}</div>;
};

describe('#1419 route exit retires the departing intent', () => {
    beforeEach(() => __resetRecordingIntentForTests());

    it('a pending cold click does not survive leaving /session', async () => {
        mint();
        expect(pendingRecordingIntent()).not.toBeNull();

        const { rerender } = render(<Harness pathname="/session" />);
        // The SAME component instance sees the path change — which is what navigation is. Remounting
        // it would reset the previous-path ref and the transition would never be observed, so this
        // must be a rerender.
        rerender(<Harness pathname="/analytics" />);

        expect(pendingRecordingIntent()).toBeNull();
        expect(lastRetiredIntent()?.reason).toBe('navigated');
    });

    it('staying on /session across a remount does NOT retire the click', async () => {
        // The failure the earlier attempt introduced: cancelling on every subscriber unmount would
        // destroy a legitimate pending intent on a remount that never left the page.
        mint();
        const { rerender } = render(<Harness pathname="/session" />);
        rerender(<Harness pathname="/session" />);
        expect(pendingRecordingIntent()).not.toBeNull();
    });

    it('a LATE route-exit callback cannot cancel the click made after returning', async () => {
        // The effect is asynchronous. By the time it runs the user may already be back on /session
        // and have clicked again — an unscoped retirement would cancel that new click instead.
        const departing = mint();
        const { retireRecordingIntent } = await import('@/services/recordingIntent');
        retireRecordingIntent('navigated', departing.token);

        const afterReturn = mint();
        retireRecordingIntent('navigated', departing.token); // the late callback, naming its own token

        expect(pendingRecordingIntent()?.token).toBe(afterReturn.token);
    });
});
