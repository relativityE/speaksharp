import React, { useState, useEffect } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { TranscriptPanel } from '../components/session/TranscriptPanel';
import { SessionSidebar } from '../components/session/SessionSidebar';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';
import { SlidersHorizontal } from 'lucide-react';
import ErrorBoundary from '../components/ErrorBoundary';

// A simplified LeftColumn that only shows the transcript.
const LeftColumnContent = ({ speechRecognition }) => {
    const { transcript } = speechRecognition;
    const isLoading = speechRecognition.isLoading && !speechRecognition.isListening;

    return (
        <div className="flex flex-col gap-component-gap h-full">
            <div className="flex-shrink-0">
                {/* The new hook doesn't have interimTranscript, so we pass an empty string. */}
                <TranscriptPanel transcript={transcript} interimTranscript="" isLoading={isLoading} />
            </div>
        </div>
    );
};

export const SessionPage = () => {
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);

    // The new hook is self-contained.
    const speechRecognition = useSpeechRecognition();
    const { isListening } = speechRecognition;

    useEffect(() => {
        let interval;
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

    return (
        <div className="container mx-auto px-component-px py-10">
            <div className="lg:flex lg:gap-component-gap relative lg:items-stretch">
                {/* Left Column */}
                <div className="lg:w-2/3 flex flex-col gap-component-gap">
                    <ErrorBoundary fallback={<p>Something went wrong in the session display.</p>}>
                        <LeftColumnContent speechRecognition={speechRecognition} />
                    </ErrorBoundary>
                </div>

                {/* Desktop Sidebar (Right Column) */}
                <div className="hidden lg:block lg:w-1/3">
                    <SessionSidebar {...speechRecognition} elapsedTime={elapsedTime} />
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
                                <SessionSidebar {...speechRecognition} elapsedTime={elapsedTime} />
                            </div>
                        </DrawerContent>
                    </Drawer>
                </div>
            </div>
        </div>
    );
};
