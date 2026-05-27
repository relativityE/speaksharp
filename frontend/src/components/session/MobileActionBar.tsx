import React from 'react';
import { Button } from '@/components/ui/button';
import { Play } from 'lucide-react';
import { TEST_IDS } from '@/constants/testIds';

interface MobileActionBarProps {
    isListening: boolean;
    isButtonDisabled: boolean;
    modelLoadingProgress: number | null;
    onStartStop: () => void;
    isFrozen?: boolean;
    onSwitchToNative?: () => void;
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
    isFrozen,
    onSwitchToNative,
}) => {
    if (!isListening && !isFrozen) {
        return null;
    }

    return (
        <div className="fixed bottom-0 left-0 right-0 px-4 pt-3 pb-[calc(0.875rem+env(safe-area-inset-bottom))] bg-background/95 backdrop-blur-xl md:hidden z-40 flex flex-col items-center gap-2.5 shadow-[0_-10px_30px_rgba(15,23,42,0.10)] safe-area-bottom border-t border-border">
            {isFrozen && (
                <Button
                    onClick={onSwitchToNative}
                    variant="outline"
                    className="h-10 w-full max-w-sm bg-amber-50 border-primary/50 text-primary font-semibold"
                    data-action="switch-to-native-mobile"
                >
                    Switch to Native (Free)
                </Button>
            )}
            <Button
                onClick={onStartStop}
                size="lg"
                variant={isListening ? 'destructive' : 'default'}
                className="h-12 w-full max-w-sm text-base font-semibold shadow-sm"
                disabled={isButtonDisabled || (modelLoadingProgress !== null && modelLoadingProgress < 100)}
                data-testid={`${TEST_IDS.SESSION_START_STOP_BUTTON}-mobile`}
            >
                {modelLoadingProgress !== null ? (
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
