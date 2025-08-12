import React from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSessionManager } from '../hooks/useSessionManager';
import { TranscriptPanel } from '../components/session/TranscriptPanel';
import { SessionSidebar } from '../components/session/SessionSidebar';

export const SessionPage = () => {
    const { saveSession } = useSessionManager();
    const [customWords, setCustomWords] = React.useState([]);

    const speechRecognition = useSpeechRecognition({ customWords });

    return (
        <div className="container mx-auto px-4 py-10">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2">
                    <TranscriptPanel {...speechRecognition} customWords={customWords} />
                </div>
                <div className="lg:col-span-1">
                    <SessionSidebar {...speechRecognition} customWords={customWords} setCustomWords={setCustomWords} saveSession={saveSession} />
                </div>
            </div>
        </div>
    );
};
