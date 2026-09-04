import React from 'react';
import { Button } from '@/components/ui/button';
import { Play, Download } from 'lucide-react';
import { TEST_IDS } from '@/constants/testIds';

interface MobileActionBarProps {
    isListening: boolean;
    isButtonDisabled: boolean;
    modelLoadingProgress: number | null;
    onStartStop: () => void;
    /** Current mode + DURABLE Private model status, so mobile mirrors the desktop first-run flow. */
    mode?: string | null;
    privateModelStatus?: string;
    onDownloadModel?: () => void;
    /**
     * #1415 — WHY the start gate is closed, in the user's words, or null when it is not.
     *
     * Mobile never received this at all, so a blocked cold press on a phone was a dead control with no
     * explanation available even in principle. Desktop could at least render a reason; mobile could
     * not.
     */
    blockedReason?: string | null;
}

/**
 * Mobile-only sticky action bar with the start/stop button.
 * Extracted from SessionPage for cleaner decomposition.
 */
export const MobileActionBar: React.FC<MobileActionBarProps> = ({
    isListening,
    isButtonDisabled,
    modelLoadingProgress,
    onStartStop,
    mode,
    privateModelStatus = 'idle',
    onDownloadModel,
    blockedReason,
}) => {
    // First-run Private: the primary control downloads the on-device model (never starts a model-less
    // engine). Mirrors the desktop mic. Every other state uses the durable isButtonDisabled gate.
    const isPrivateDownloadRequired = mode === 'private' && privateModelStatus === 'download-required' && !isListening;
    // #1258: after a Private setup FAILURE the control becomes an actionable "Retry Private setup" — always
    // enabled and routed to the same setup entry point, so a failed model setup is never a dead end.
    const isPrivateRetry = mode === 'private' && (privateModelStatus === 'init-failed' || privateModelStatus === 'error') && !isListening;
    // Same rule as the desktop card: a retry is actionable, everything else that is blocked explains
    // itself rather than presenting a dead control.
    const isBlockedFromStart = !!blockedReason && !isPrivateRetry && !isListening;
    // #1415 — MOBILE IS THE SAME ONE-CLICK PATH AS DESKTOP.
    //
    // `isPrivateSetupAction` previously bundled the cold start together with the retry, so a cold
    // mobile press called `onDownloadModel` and stopped there — preserving on mobile exactly the
    // two-click failure this issue removes on desktop. They are different actions and are now split:
    //
    //   cold start  -> the recording intent (`onStartStop`), which consents, prepares AND records
    //   retry       -> the setup entry point, because auto-retrying a broken engine would loop
    //                  behind a spinner the user cannot escape
    //
    // Only the retry stays unconditionally enabled. A cold RECORDING request is still a recording
    // request, so it honours the durable start gate like any other — see `disabled` below.
    //
    // There is deliberately no combined "setup action" binding any more: a name meaning "retry OR
    // cold start" is the conflation that produced this defect, and keeping it would invite the next
    // edit to reuse it.
    // The sticky mobile bar stays visible in every session state — including IDLE — so the
    // primary "Start Recording" CTA is always reachable without scrolling to the recording
    // card (aligns mobile with the always-present desktop control). The button below already
    // renders the correct state: Start (idle) / Stop (listening) / download progress; the
    return (
        <div className="fixed bottom-0 left-0 right-0 px-4 pt-3 pb-[calc(0.875rem+env(safe-area-inset-bottom))] bg-background/95 backdrop-blur-xl md:hidden z-40 flex flex-col items-center gap-2.5 shadow-[0_-10px_30px_rgba(15,23,42,0.10)] safe-area-bottom border-t border-border">
            <Button
                onClick={() => { if (isPrivateRetry) { onDownloadModel?.(); } else { onStartStop(); } }}
                size="lg"
                variant={isListening ? 'destructive' : 'default'}
                className="h-12 w-full max-w-sm text-base font-semibold shadow-sm"
                disabled={isPrivateRetry ? false : (isButtonDisabled || (modelLoadingProgress !== null && modelLoadingProgress < 100))}
                data-testid={`${TEST_IDS.SESSION_START_STOP_BUTTON}-mobile`}
                aria-describedby={isBlockedFromStart ? 'mobile-start-blocked-reason' : undefined}
            >
                {isPrivateRetry ? (
                    <>
                        <Download className="w-5 h-5 mr-2" /> Retry Private setup
                    </>
                ) : isPrivateDownloadRequired ? (
                    <>
                        {/* Truthful about BOTH things the press does — the same words as the desktop
                            control, so the two surfaces cannot promise different outcomes. */}
                        <Download className="w-5 h-5 mr-2" /> Download &amp; start recording
                    </>
                ) : modelLoadingProgress !== null ? (
                    <>
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                        Downloading {Math.round(modelLoadingProgress)}%
                    </>
                ) : isListening ? (
                    <>
                        <span className="relative flex h-3 w-3 mr-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                        </span>
                        Stop Recording
                    </>
                ) : (
                    <>
                        <Play className="w-5 h-5 mr-2" /> Start Recording
                    </>
                )}
            </Button>
            {isBlockedFromStart && (
                /*
                 * #1415 — the bounded reason, rendered where the press failed.
                 *
                 * `role="status"` rather than `alert`: a blocked start is a condition to read, not an
                 * interruption. `aria-describedby` on the button ties the two together, so a screen
                 * reader announces the reason with the control instead of leaving a disabled button
                 * with no explanation anywhere near it.
                 */
                <p
                    id="mobile-start-blocked-reason"
                    role="status"
                    data-testid="mobile-start-blocked-reason"
                    className="max-w-sm text-center text-xs font-semibold text-muted-foreground"
                >
                    {blockedReason}
                </p>
            )}
        </div>
    );
};

export default MobileActionBar;
