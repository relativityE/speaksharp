import React, { useState, useEffect } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSessionManager } from '../hooks/useSessionManager';
import posthog from 'posthog-js';
import { FILLER_WORD_KEYS } from '../config';
import { TranscriptPanel } from '../components/session/TranscriptPanel';
import FillerWordAnalysis from '../components/session/FillerWordAnalysis';
import AISuggestions from '../components/session/AISuggestions';
import { SessionSidebar } from '../components/session/SessionSidebar';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';
import { SlidersHorizontal, AlertTriangle, Loader } from 'lucide-react';
import ErrorBoundary from '../components/ErrorBoundary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UpgradePromptDialog } from '@/components/UpgradePromptDialog';
import { useAuth } from '../contexts/useAuth';
import { useSession } from '../contexts/useSession';
import logger from '@/lib/logger';
import type { PracticeSession } from '@/types/session';

// --- Prop and Type Interfaces ---

type SpeechRecognitionHook = ReturnType<typeof useSpeechRecognition>;

interface LeftColumnContentProps {
    speechRecognition: SpeechRecognitionHook;
    customWords: string[];
    setCustomWords: React.Dispatch<React.SetStateAction<string[]>>;
}

interface ModelLoadProgress {
    status: string;
    file?: string;
    loaded?: number;
    total?: number;
}

// --- Sub-components ---

const LeftColumnContent: React.FC<LeftColumnContentProps> = ({ speechRecognition, customWords, setCustomWords }) => {
    const { error, isSupported, isListening, isReady, transcript, fillerData } = speechRecognition;

    if (!isSupported) {
        return (
             <Card className="flex-grow">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <AlertTriangle className="text-yellow-500" /> Browser Not Supported
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p>Your browser does not support the selected speech recognition engine. Please try a different browser like Google Chrome.</p>
                </CardContent>
            </Card>
        );
    }

    const isLoading = isListening && !isReady;

    return (
        <div className="flex flex-col gap-component-gap h-full">
            <div className="flex-shrink-0">
                <TranscriptPanel
                    {...speechRecognition}
                    isLoading={isLoading}
                    isListening={isListening}
                    isReady={isReady}
                    error={error}
                />
            </div>
            <div className="flex-grow flex flex-col">
                <FillerWordAnalysis
                    fillerData={fillerData}
                    customWords={customWords}
                    addCustomWord={(word) => setCustomWords(prev => [...prev, word])}
                    defaultFillerWords={Object.values(FILLER_WORD_KEYS)}
                    className="flex-grow"
                />
                {!isListening && transcript && (
                    <div className="mt-8">
                        <AISuggestions transcript={transcript} />
                    </div>
                )}
            </div>
        </div>
    );
};

// --- Main Component ---

export const SessionPage: React.FC = () => {
    const { user, profile, session, loading } = useAuth();
    const { saveSession: saveSessionToBackend } = useSessionManager();
    const { addSession } = useSession();
    const [customWords, setCustomWords] = useState<string[]>([]);
    const [usageLimitExceeded, setUsageLimitExceeded] = useState(false);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);

    const speechRecognition = useSpeechRecognition({ customWords, session, profile });
    const { isListening, modelLoadingProgress } = speechRecognition;

    logger.info({ profile, loading, usageLimitExceeded }, 'SessionPage render state');

    useEffect(() => {
        posthog.capture('session_page_viewed');
    }, []);

    useEffect(() => {
        let interval: NodeJS.Timeout | null = null;
        if (isListening) {
            interval = setInterval(() => {
                setElapsedTime(prevTime => prevTime + 1);
            }, 1000);
        } else {
            setElapsedTime(0);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isListening]);

    useEffect(() => {
        if (!isListening) return;

        const sessionLimit = !user
            ? 120
            : profile?.subscription_status !== 'pro'
                ? 1800
                : null;

        if (sessionLimit && elapsedTime >= sessionLimit) {
            speechRecognition.stopListening();
            setUsageLimitExceeded(true);
        }
    }, [elapsedTime, isListening, user, profile, speechRecognition]);

    if (loading) {
        return (
            <div className="container mx-auto px-component-px py-10 flex justify-center items-center">
                <Loader className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    const saveAndBroadcastSession = async (sessionData: Partial<PracticeSession>) => {
        const result = await saveSessionToBackend(sessionData);
        if (result.session) {
            addSession(result.session);
        }
        if (result.usageExceeded) {
            setUsageLimitExceeded(true);
        }
        return result;
    };

    return (
        <div className="container mx-auto px-component-px py-10">
            <UpgradePromptDialog
                open={usageLimitExceeded}
                onOpenChange={setUsageLimitExceeded}
            />
            <div className="lg:flex lg:gap-component-gap relative lg:items-stretch">
                <div className="lg:w-2/3 flex flex-col gap-component-gap">
                    <ErrorBoundary>
                        <LeftColumnContent
                            speechRecognition={speechRecognition}
                            customWords={customWords}
                            setCustomWords={setCustomWords}
                        />
                    </ErrorBoundary>
                </div>

                <div className="hidden lg:block lg:w-1/3">
                    <SessionSidebar {...speechRecognition} saveSession={saveAndBroadcastSession} actualMode={speechRecognition.mode} elapsedTime={elapsedTime} modelLoadingProgress={modelLoadingProgress as ModelLoadProgress | null} />
                </div>

                <div className="block lg:hidden">
                    <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
                        <DrawerTrigger asChild>
                            <Button variant="outline" size="icon" className="fixed bottom-6 right-6 z-50 h-16 w-16 rounded-full shadow-lg flex items-center justify-center">
                                <SlidersHorizontal className="h-8 w-8" />
                                <span className="sr-only">Open session controls</span>
                            </Button>
                        </DrawerTrigger>
                        <DrawerContent>
                            <div className="p-4 overflow-y-auto h-[80vh]">
                                <SessionSidebar {...speechRecognition} saveSession={saveAndBroadcastSession} actualMode={speechRecognition.mode} elapsedTime={elapsedTime} modelLoadingProgress={modelLoadingProgress as ModelLoadProgress | null} />
                            </div>
                        </DrawerContent>
                    </Drawer>
                </div>
            </div>
        </div>
    );
};
