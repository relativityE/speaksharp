import React, { useState, useEffect } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSessionManager } from '../hooks/useSessionManager';
import posthog from 'posthog-js';
import { FILLER_WORD_KEYS } from '../config';
import { TranscriptPanel } from '../components/session/TranscriptPanel';
import FillerWordAnalysis from '../components/session/FillerWordAnalysis';
import { SessionSidebar } from '../components/session/SessionSidebar';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';
import { SlidersHorizontal, AlertTriangle, Loader } from 'lucide-react';
import ErrorBoundary from '../components/ErrorBoundary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const LeftColumnContent = ({ speechRecognition, customWords, setCustomWords }) => {
    const { error, isSupported, isListening, transcript, interimTranscript } = speechRecognition;

    if (error) {
        return (
            <Card className="flex-grow">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <AlertTriangle className="text-red-500" /> Error
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-red-500">{error.message}</p>
                    <p className="text-muted-foreground mt-2">
                        Speech recognition could not be initialized. Please check your browser permissions and try refreshing the page.
                    </p>
                </CardContent>
            </Card>
        );
    }

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
        <div className="flex flex-col gap-8 h-full">
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
            </div>
        </div>
    );
};


export const SessionPage = () => {
    const { saveSession } = useSessionManager();
    const [customWords, setCustomWords] = useState([]);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    const speechRecognition = useSpeechRecognition({ customWords });
    const { mode, setMode } = speechRecognition;

    useEffect(() => {
        posthog.capture('session_page_viewed');
    }, []);

    return (
        <div className="container mx-auto px-4 py-10">
            <div className="lg:flex lg:gap-8 relative lg:items-stretch">
                {/* Left Column */}
                <div className="lg:w-2/3 flex flex-col gap-8">
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
                    <SessionSidebar {...speechRecognition} saveSession={saveSession} mode={mode} setMode={setMode} />
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
                                <SessionSidebar {...speechRecognition} saveSession={saveSession} mode={mode} setMode={setMode} />
                            </div>
                        </DrawerContent>
                    </Drawer>
                </div>
            </div>
        </div>
    );
};
