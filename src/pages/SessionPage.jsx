import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSessionManager } from '../hooks/useSessionManager';

export const SessionPage = () => {
    const navigate = useNavigate();
    const { saveSession } = useSessionManager();
    const [customWord, setCustomWord] = useState('');
    const [customWords, setCustomWords] = useState([]);
    const [overrideTimer, setOverrideTimer] = useState(false);

    const {
        isListening,
        transcript,
        fillerCounts,
        error,
        isSupported,
        startListening,
        stopListening,
        reset,
    } = useSpeechRecognition({ customWords });

    const [elapsedTime, setElapsedTime] = useState(0);
    const timerIntervalRef = useRef(null);

    const totalFillerWords = Object.values(fillerCounts).reduce((sum, count) => sum + count, 0);

    const updateTimer = () => {
        setElapsedTime(prev => prev + 1);
    };

    const endSession = (shouldNavigateToAnalytics = false) => {
        stopListening();
        const sessionData = {
            date: new Date().toISOString(),
            duration: elapsedTime,
            fillerCounts: fillerCounts,
            transcript: transcript,
            totalFillerWords: totalFillerWords,
        };
        saveSession(sessionData);
        if (shouldNavigateToAnalytics) {
            navigate('/analytics');
        } else {
            navigate('/');
        }
    };

    useEffect(() => {
        if (isListening) {
            timerIntervalRef.current = setInterval(updateTimer, 1000);
            if (elapsedTime >= 120 && !overrideTimer) {
                endSession(true);
            }
        } else {
            clearInterval(timerIntervalRef.current);
        }
        return () => clearInterval(timerIntervalRef.current);
    }, [isListening, elapsedTime, overrideTimer, endSession]);

    const startRecording = () => {
        if (!isListening) {
            reset();
            setElapsedTime(0);
            startListening();
        } else {
            stopListening();
        }
    };

    const addCustomWord = () => {
        if (customWord && !customWords.includes(customWord)) {
            setCustomWords(prev => [...prev, customWord]);
            setCustomWord('');
        }
    };

    const formatTime = (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    };

    const colors = ['blue', 'green', 'orange', 'purple', 'red', 'pink', 'teal', 'yellow'];

    const formatFillerWord = (word) => {
        if (word.includes('_')) {
            return word.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    };

    return (
        <div className="container session-page">
            <div className="header">
                <h1>SpeakSharp</h1>
                <p className="text-tagline font-size-body-main">Cut the clutter. Speak with clarity.</p>
            </div>

            <div className="card session-card">
                <div className="timer font-size-body-main">{formatTime(elapsedTime)}</div>
                <h2>
                    <span className="microphone-icon"></span>
                    Session Control
                </h2>
                <p className="font-size-body-main">Start recording to begin tracking your speech patterns. The session will end automatically after 2 minutes.</p>
                <div className="button-group">
                    <button className="start-button font-size-body-main" onClick={startRecording}>
                        {isListening ? 'Stop Recording' : 'Start Recording'}
                    </button>
                    <button className="end-button font-size-body-main" onClick={() => endSession(false)}>
                        End Session
                    </button>
                </div>
                <div style={{ marginTop: '20px', textAlign: 'center', color: '#666' }}>
                    <input
                        type="checkbox"
                        id="overrideTimer"
                        checked={overrideTimer}
                        onChange={(e) => setOverrideTimer(e.target.checked)}
                    />
                    <label htmlFor="overrideTimer" className="font-size-body-main" style={{ marginLeft: '8px' }}>Override 2-minute timer (for development)</label>
                </div>
            </div>

            <div className="card status-card">
                <div className="status-indicator">
                    <span className="status-dot" style={{ background: isListening ? '#ef4444' : '#94a3b8' }}></span>
                    <span className="status-text font-size-body-main">{isListening ? 'Recording...' : 'Ready to Record'}</span>
                </div>
                <p className="total-count font-size-body-main">Total filler words detected: <strong>{totalFillerWords}</strong></p>
                {error && <p className="font-size-body-main" style={{ color: 'red', marginTop: '10px' }}>{error}</p>}
                {!isSupported && <p className="font-size-body-main" style={{ color: 'red', marginTop: '10px' }}>Speech recognition is not supported in this browser.</p>}
            </div>

            <div style={{ textAlign: 'center', margin: '20px 0' }}>
                <a onClick={() => navigate('/analytics')} className="font-size-body-main" style={{ cursor: 'pointer', textDecoration: 'underline', color: '#666' }}>View Detailed Analytics</a>
            </div>

            <div className="card detection-card">
                <h2>
                    <span className="chart-icon"></span>
                    Filler Word Detection
                </h2>
                <p className="font-size-body-main">Real-time tracking of common filler words</p>

                <div className="filler-grid">
                    {Object.entries(fillerCounts).map(([word, count], index) => (
                        <div className="filler-item" key={word}>
                            <div className={`filler-count ${colors[index % colors.length]} font-size-body-main`}>{count}</div>
                            <div className="filler-label font-size-body-main">{formatFillerWord(word)}</div>
                        </div>
                    ))}
                </div>

                <div style={{ marginTop: '30px' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <label htmlFor="customWord" className="font-size-body-main" style={{ fontWeight: '500' }}>custom word</label>
                        <input
                            id="customWord"
                            type="text"
                            value={customWord}
                            onChange={(e) => setCustomWord(e.target.value)}
                            placeholder="Enter word"
                            className="font-size-body-main"
                            style={{ padding: '8px', borderRadius: '8px', border: '1px solid #ddd', maxWidth: '120px' }}
                            maxLength="10"
                        />
                        <button onClick={addCustomWord} className="start-button font-size-body-main" style={{ padding: '8px 16px' }}>Add</button>
                    </div>
                </div>
            </div>

            <div className="card">
                <h2>Live Transcript</h2>
                <div className="font-size-body-main" style={{ marginTop: '10px', padding: '10px', border: '1px solid #ddd', borderRadius: '8px', minHeight: '100px', background: '#f8fafc' }}>
                    {transcript}
                </div>
            </div>
        </div>
    );
};
