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
}) => {
    // First-run Private: the primary control downloads the on-device model (never starts a model-less
    // engine). Mirrors the desktop mic. Every other state uses the durable isButtonDisabled gate.
    const isPrivateDownloadRequired = mode === 'private' && privateModelStatus === 'download-required' && !isListening;
    // #1258: after a Private setup FAILURE the control becomes an actionable "Retry Private setup" — always
    // enabled and routed to the same setup entry point, so a failed model setup is never a dead end.
    const isPrivateRetry = mode === 'private' && (privateModelStatus === 'init-failed' || privateModelStatus === 'error') && !isListening;
    const isPrivateSetupAction = isPrivateDownloadRequired || isPrivateRetry;
    // The sticky mobile bar stays visible in every session state — including IDLE — so the
    // primary "Start Recording" CTA is always reachable without scrolling to the recording
    // card (aligns mobile with the always-present desktop control). The button below already
    // renders the correct state: Start (idle) / Stop (listening) / download progress; the
    return (
        <div className="fixed bottom-0 left-0 right-0 px-4 pt-3 pb-[calc(0.875rem+env(safe-area-inset-bottom))] bg-background/95 backdrop-blur-xl md:hidden z-40 flex flex-col items-center gap-2.5 shadow-[0_-10px_30px_rgba(15,23,42,0.10)] safe-area-bottom border-t border-border">
            <Button
                onClick={() => { if (isPrivateSetupAction) { onDownloadModel?.(); } else { onStartStop(); } }}
                size="lg"
                variant={isListening ? 'destructive' : 'default'}
                className="h-12 w-full max-w-sm text-base font-semibold shadow-sm"
                disabled={isPrivateSetupAction ? false : (isButtonDisabled || (modelLoadingProgress !== null && modelLoadingProgress < 100))}
                data-testid={`${TEST_IDS.SESSION_START_STOP_BUTTON}-mobile`}
            >
                {isPrivateRetry ? (
                    <>
                        <Download className="w-5 h-5 mr-2" /> Retry Private setup
                    </>
                ) : isPrivateDownloadRequired ? (
                    <>
                        <Download className="w-5 h-5 mr-2" /> Set up Private
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
        </div>
    );
};

export default MobileActionBar;
