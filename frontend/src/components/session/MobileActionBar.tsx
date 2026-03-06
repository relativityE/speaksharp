import React from 'react';
import { Button } from '@/components/ui/button';
import { Play } from 'lucide-react';
import { TEST_IDS } from '@/constants/testIds';

interface MobileActionBarProps {
    isListening: boolean;
    isButtonDisabled: boolean;
    modelLoadingProgress: number | null;
    onStartStop: () => void;
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
}) => {
    return (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/90 backdrop-blur-lg md:hidden z-50 flex justify-center shadow-[0_-10px_30px_rgba(0,0,0,0.5)] safe-area-bottom before:absolute before:inset-x-0 before:top-0 before:h-[1px] before:bg-gradient-to-r before:from-transparent before:via-primary/50 before:to-transparent">
            <Button
                onClick={onStartStop}
                size="lg"
                variant={isListening ? 'destructive' : 'default'}
                className="w-full max-w-sm h-12 text-lg font-semibold shadow-lg"
                disabled={isButtonDisabled || modelLoadingProgress !== null}
                data-testid={`${TEST_IDS.SESSION_START_STOP_BUTTON}-mobile`}
            >
                {modelLoadingProgress !== null ? (
                    <>
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                        Initializing...
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
