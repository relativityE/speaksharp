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

const LeftColumnContent = ({ speechRecognition, customWords, setCustomWords }) => {
    const { error, isSupported, isListening, transcript, interimTranscript } = speechRecognition;


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

    const isLoading = isListening && !transcript && !interimTranscript;

    return (
        <div className="flex flex-col gap-component-gap h-full">
            <div className="flex-shrink-0">
                <TranscriptPanel {...speechRecognition} isLoading={isLoading} />
            </div>
            <div className="flex-grow flex flex-col">
                <FillerWordAnalysis
                    fillerData={speechRecognition.fillerData}
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


import { useAuth } from '../contexts/AuthContext';

export const SessionPage = () => {
    const { user, profile } = useAuth();
    const { saveSession, usageLimitExceeded, setUsageLimitExceeded } = useSessionManager();
    const [customWords, setCustomWords] = useState([]);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [mode, setMode] = useState('cloud');
    const [elapsedTime, setElapsedTime] = useState(0);

    const speechRecognition = useSpeechRecognition({ customWords, mode });
    const { isListening, modelLoadingProgress } = speechRecognition;

    useEffect(() => {
        posthog.capture('session_page_viewed');
    }, []);

    useEffect(() => {
        let interval;
        if (isListening) {
            interval = setInterval(() => {
                setElapsedTime(prevTime => prevTime + 1);
            }, 1000);
        } else {
            setElapsedTime(0); // Reset timer when not listening
        }

        return () => {
            if (interval) {
                clearInterval(interval);
            }
        };
    }, [isListening]);

    useEffect(() => {
        if (!isListening) return;

        const sessionLimit = !user
            ? 120 // 2 minutes for anonymous users
            : profile?.subscription_status !== 'pro'
                ? 1800 // 30 minutes for free users
                : null; // No limit for pro users

        if (sessionLimit && elapsedTime >= sessionLimit) {
            speechRecognition.stopListening();
            setUsageLimitExceeded(true);
        }
    }, [elapsedTime, isListening, user, profile, speechRecognition.stopListening, setUsageLimitExceeded]);

    return (
        <div className="container mx-auto px-component-px py-10">
            <UpgradePromptDialog
                open={usageLimitExceeded}
                onOpenChange={setUsageLimitExceeded}
            />
            <div className="lg:flex lg:gap-component-gap relative lg:items-stretch">
                {/* Left Column */}
                <div className="lg:w-2/3 flex flex-col gap-component-gap">
                    <ErrorBoundary fallback={<p>Something went wrong in the session display.</p>}>
                        <LeftColumnContent
                            speechRecognition={speechRecognition}
                            customWords={customWords}
                            setCustomWords={setCustomWords}
                        />
                    </ErrorBoundary>
                </div>

                {/* Desktop Sidebar (Right Column) */}
                <div className="hidden lg:block lg:w-1/3">
                    <SessionSidebar {...speechRecognition} saveSession={saveSession} desiredMode={mode} setMode={setMode} actualMode={speechRecognition.mode} elapsedTime={elapsedTime} modelLoadingProgress={modelLoadingProgress} />
                </div>

                {/* Mobile Drawer */}
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
                                <SessionSidebar {...speechRecognition} saveSession={saveSession} desiredMode={mode} setMode={setMode} actualMode={speechRecognition.mode} elapsedTime={elapsedTime} modelLoadingProgress={modelLoadingProgress} />
                            </div>
                        </DrawerContent>
                    </Drawer>
                </div>
            </div>
        </div>
    );
};
