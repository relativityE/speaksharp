import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Settings } from 'lucide-react';
import { useSessionLifecycle } from '@/hooks/useSessionLifecycle';
import { PauseMetricsDisplay } from '@/components/session/PauseMetricsDisplay';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { UserFillerWordsManager } from '@/components/session/UserFillerWordsManager';
import { SessionPageSkeleton } from '@/components/session/SessionPageSkeleton';
import { ClarityScoreCard } from '@/components/session/ClarityScoreCard';
import { SpeakingRateCard } from '@/components/session/SpeakingRateCard';
import { FillerWordsCard } from '@/components/session/FillerWordsCard';
import { LiveTranscriptPanel } from '@/components/session/LiveTranscriptPanel';
import { SpeakingTipsCard } from '@/components/session/SpeakingTipsCard';
import { LiveRecordingCard } from '@/components/session/LiveRecordingCard';
import { MobileActionBar } from '@/components/session/MobileActionBar';
import { StatusNotificationBar } from '@/components/session/StatusNotificationBar';
import { SttStatus } from '@/types/transcription';
import { PromoExpiredDialog } from '@/components/PromoExpiredDialog';
import { LocalErrorBoundary } from '@/components/LocalErrorBoundary';

/**
 * ARCHITECTURE (Senior Architect):
 * SessionPage is now a "Thin View" component.
 * All complex state orchestration, timer logic, and persistence flows 
 * have been extracted into useSessionLifecycle.
 */
export const SessionPage: React.FC = () => {
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const transcriptContainerRef = useRef<HTMLDivElement>(null);

    const {
        isListening,
        isReady,
        metrics,
        sttStatus,
        modelLoadingProgress,
        mode,
        setMode,
        elapsedTime,
        handleStartStop,
        showAnalyticsPrompt,
        sessionFeedbackMessage,
        pauseMetrics,
        transcriptContent,
        fillerData,
        isProUser,
        activeEngine,
        isButtonDisabled,
        showPromoExpiredDialog
    } = useSessionLifecycle();

    // Auto-scroll transcript to bottom
    useEffect(() => {
        if (transcriptContainerRef.current && transcriptContent) {
            transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
        }
    }, [transcriptContent]);


    if (!metrics) return <SessionPageSkeleton />;

    // EXECUTIVE PATTERN: Dual-State Status Derivation
    // We no longer choose between "Recording" OR "Downloading".
    // We pass "Recording" as the primary state, and "Downloading" as the secondary state (via progress).

    // 1. Determine Primary Status (Session State)
    const isActiveStt = sttStatus.type === 'initializing' || sttStatus.type === 'downloading' || sttStatus.type === 'fallback' || isListening;

    // Executive Pattern: Status resolution logic
    const getBaseStatus = (): SttStatus => {
        if (sessionFeedbackMessage) {
            const isError = sessionFeedbackMessage.startsWith('⚠️') || sessionFeedbackMessage.startsWith('⛔');
            return {
                type: isError ? 'error' : 'ready',
                message: sessionFeedbackMessage
            } as SttStatus;
        }
        if (isActiveStt && (sttStatus as SttStatus).type !== 'idle') {
            return sttStatus as SttStatus;
        }
        if (showAnalyticsPrompt) {
            return {
                type: 'ready',
                message: '✓ Session saved. Click Analytics above to review.'
            } as SttStatus;
        }
        return sttStatus as SttStatus;
    };

    const baseStatus = getBaseStatus();

    // 2. Compose Final Status (Attach Background Progress)
    const displayStatus: SttStatus = {
        ...baseStatus,
        progress: modelLoadingProgress ?? undefined
    };

    const fadeUp = {
        hidden: { opacity: 0, y: 30 },
        visible: (i: number) => ({
            opacity: 1, y: 0,
            transition: { delay: i * 0.1, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] },
        }),
    };

    return (
        <div className="min-h-screen bg-background bg-gradient-radial pt-20">
            {/* Grid Overlay */}
            <div className="fixed inset-0 bg-grid opacity-20 pointer-events-none" />

            {/* Page Header */}
            <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-white/5">
                <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={fadeUp}
                    custom={0}
                >
                    <h1 className="text-2xl font-bold text-foreground mb-1">Practice Session</h1>
                    <p className="text-xs text-muted-foreground">We'll analyze your speech patterns in real-time</p>
                </motion.div>
            </header>

            {/* Status Bar */}
            <motion.div
                className="relative z-10 max-w-6xl mx-auto px-6 mt-4"
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                custom={1}
            >
                <StatusNotificationBar status={displayStatus} />
            </motion.div>

            {/* Main Content Grid */}
            <div className="relative z-10 max-w-6xl mx-auto px-6 py-8">
                <div className="grid lg:grid-cols-3 gap-6">
                    {/* Main Area */}
                    <motion.div
                        className="lg:col-span-2 space-y-6"
                        initial="hidden"
                        animate="visible"
                        variants={fadeUp}
                        custom={2}
                    >
                        <LocalErrorBoundary isolationKey="recording-controls" componentName="LiveRecordingCard">
                            <LiveRecordingCard
                                mode={mode}
                                isListening={isListening}
                                isReady={isReady}
                                isProUser={isProUser}
                                activeEngine={activeEngine}
                                statusMessage={sttStatus.message}
                                formattedTime={metrics.formattedTime}
                                elapsedSeconds={elapsedTime}
                                isButtonDisabled={isButtonDisabled}
                                onModeChange={setMode}
                                onStartStop={handleStartStop}
                            />
                        </LocalErrorBoundary>

                        <LocalErrorBoundary isolationKey="live-transcript" componentName="LiveTranscriptPanel">
                            <LiveTranscriptPanel
                                transcript={transcriptContent}
                                isListening={isListening}
                                containerRef={transcriptContainerRef}
                                className="min-h-[400px]"
                            />
                        </LocalErrorBoundary>
                    </motion.div>

                    {/* Sidebar */}
                    <motion.div
                        className="space-y-6"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.4, duration: 0.6 }}
                    >
                        <LocalErrorBoundary isolationKey="filler-words" componentName="FillerWordsCard">
                            <FillerWordsCard
                                fillerCount={metrics.fillerCount}
                                fillerData={fillerData}
                                headerAction={
                                    <Popover open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-primary underline-offset-4 hover:underline"
                                                data-testid="add-custom-word-button"
                                            >
                                                <Settings className="h-4 w-4" />
                                                Custom
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-80 bg-card border-border shadow-xl mr-6">
                                            <UserFillerWordsManager onWordAdded={() => setIsSettingsOpen(false)} />
                                        </PopoverContent>
                                    </Popover>
                                }
                            />
                        </LocalErrorBoundary>

                        <div className="grid grid-cols-2 gap-4">
                            <LocalErrorBoundary isolationKey="clarity-score" componentName="ClarityScoreCard">
                                <ClarityScoreCard
                                    clarityScore={metrics.clarityScore}
                                    clarityLabel={metrics.clarityLabel}
                                />
                            </LocalErrorBoundary>
                            <LocalErrorBoundary isolationKey="speaking-rate" componentName="SpeakingRateCard">
                                <SpeakingRateCard
                                    wpm={metrics.wpm}
                                    wpmLabel={metrics.wpmLabel}
                                />
                            </LocalErrorBoundary>
                        </div>

                        <LocalErrorBoundary isolationKey="pause-metrics" componentName="PauseMetricsDisplay">
                            <PauseMetricsDisplay
                                metrics={pauseMetrics}
                            />
                        </LocalErrorBoundary>

                        <LocalErrorBoundary isolationKey="speaking-tips" componentName="SpeakingTipsCard">
                            <SpeakingTipsCard />
                        </LocalErrorBoundary>
                    </motion.div>
                </div>
            </div>

            {/* Mobile Sticky Action Bar */}
            <MobileActionBar
                isListening={isListening}
                isButtonDisabled={isButtonDisabled}
                modelLoadingProgress={modelLoadingProgress}
                onStartStop={handleStartStop}
            />

            {/* Promo Expired Dialog */}
            <PromoExpiredDialog
                open={showPromoExpiredDialog}
                onOpenChange={() => { }} // Controlled by hook data
            />
        </div>
    );
};

export default SessionPage;