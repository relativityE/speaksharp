import { useEffect, useRef } from 'react';
import { pendingRecordingIntent, retireRecordingIntent } from '@/services/recordingIntent';
import logger from '@/lib/logger';

/**
 * #1419 correction 2 — LEAVING `/session` RETIRES THAT CLICK.
 *
 * A cold click mints an intent that deliberately outlives model preparation, so a READY arriving
 * minutes later still starts the recording the user asked for. Leaving the page has to end it.
 * Otherwise the click stays armed: the user comes back, a late or fresh READY lands, and the
 * microphone activates without them having asked for it on the page they are now on. Consent does
 * not survive the page it was given on.
 *
 * WHY IT IS NOT IN `useSessionLifecycle`'s UNMOUNT, where the first attempt put it: that cleanup runs
 * on every React remount and is deliberately a SOFT reset. Turning it into cancellation would destroy
 * legitimate pending intents on remounts that never left the page, and it cannot tell navigation from
 * remounting in the first place. Comparing the previous path to the current one is the only signal
 * that actually means "the user left".
 *
 * EXTRACTED FROM `App` so a casualty can drive the real thing. Inline, the only way to test it was to
 * reproduce it in the test — which proves the copy behaves, not the product.
 */
export function useRouteExitIntentRetirement(pathname: string, exitFrom = '/session'): void {
    const prevPathRef = useRef(pathname);

    useEffect(() => {
        const prevPath = prevPathRef.current;
        prevPathRef.current = pathname;
        if (prevPath !== exitFrom || pathname === exitFrom) return;

        // Read the token FIRST and scope the retirement to it. This effect can run after the user has
        // already navigated back and clicked again, and an unscoped retirement would cancel that
        // newer click instead of the departing one.
        const departingToken = pendingRecordingIntent()?.token;
        if (!departingToken) return;
        retireRecordingIntent('navigated', departingToken);
        logger.debug({ departingToken }, '[routeExit] #1419 retired the pending recording intent');
    }, [pathname, exitFrom]);
}
