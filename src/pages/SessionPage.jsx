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
        <div className="container" style={{ display: 'flex', gap: '40px', paddingTop: '40px' }}>
            <TranscriptPanel {...speechRecognition} customWords={customWords} />
            <SessionSidebar {...speechRecognition} customWords={customWords} setCustomWords={setCustomWords} saveSession={saveSession} />
        </div>
    );
};
