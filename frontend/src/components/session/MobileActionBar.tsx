import React from 'react';
import { Button } from '@/components/ui/button';
import { Square, Play } from 'lucide-react';
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
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/90 backdrop-blur-lg border-t border-white/10 md:hidden z-50 flex justify-center shadow-lg safe-area-bottom">
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
                        <Square className="w-5 h-5 mr-2" /> Stop Recording
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
