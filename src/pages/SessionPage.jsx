import React, { useState, useEffect } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSessionManager } from '../hooks/useSessionManager';
import posthog from 'posthog-js';
import { toast } from 'sonner';
import { TranscriptPanel } from '../components/session/TranscriptPanel';
import { SessionSidebar } from '../components/session/SessionSidebar';
import { FillerWordAnalysis } from '../components/session/FillerWordAnalysis';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';
import { SlidersHorizontal } from 'lucide-react';

export const SessionPage = () => {
    const { saveSession } = useSessionManager();
    const [customWords, setCustomWords] = useState([]);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    const speechRecognition = useSpeechRecognition({ customWords });
    const { mode, fillerData } = speechRecognition;

    useEffect(() => {
        posthog.capture('session_page_viewed');
    }, []);

    useEffect(() => {
        if (mode) {
            toast.info(`Transcription mode: ${mode}`);
        }
    }, [mode]);

    return (
        <div className="container mx-auto px-4 py-10">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 relative">
                <div className="lg:col-span-2 space-y-6">
                    <TranscriptPanel {...speechRecognition} />
                    <FillerWordAnalysis fillerData={fillerData} customWords={customWords} setCustomWords={setCustomWords} />
                </div>

                {/* Desktop Sidebar */}
                <div className="hidden lg:block lg:col-span-1">
                    <SessionSidebar {...speechRecognition} saveSession={saveSession} />
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
                                <SessionSidebar {...speechRecognition} saveSession={saveSession} />
                            </div>
                        </DrawerContent>
                    </Drawer>
                </div>
            </div>
        </div>
    );
};
