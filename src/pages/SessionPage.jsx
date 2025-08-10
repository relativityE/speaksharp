import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

export const SessionPage = () => {
    const navigate = useNavigate();
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
    }, [isListening, elapsedTime, overrideTimer]);

    const startRecording = () => {
        if (!isListening) {
            reset();
            setElapsedTime(0);
            startListening();
        } else {
            stopListening();
        }
    };

    const endSession = (shouldNavigateToAnalytics = false) => {
        stopListening();
        const sessionData = {
            id: Date.now(),
            date: new Date().toISOString(),
            duration: elapsedTime,
            fillerCounts: fillerCounts,
            transcript: transcript,
            totalFillerWords: totalFillerWords,
        };

        const history = JSON.parse(localStorage.getItem('saylessSessionHistory')) || [];
        history.push(sessionData);
        localStorage.setItem('saylessSessionHistory', JSON.stringify(history));

        if (shouldNavigateToAnalytics) {
            navigate('/analytics');
        } else {
            navigate('/');
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
                <p style={{ fontStyle: 'italic', fontSize: '3rem' }}>Cut the clutter. Speak with clarity.</p>
            </div>

            <div className="card session-card">
                <div className="timer" style={{ fontSize: '3rem' }}>{formatTime(elapsedTime)}</div>
                <h2>
                    <span className="microphone-icon"></span>
                    Session Control
                </h2>
                <p style={{ fontSize: '3rem' }}>Start recording to begin tracking your speech patterns. The session will end automatically after 2 minutes.</p>
                <div className="button-group">
                    <button className="start-button" onClick={startRecording} style={{ fontSize: '3rem' }}>
                        {isListening ? 'Stop Recording' : 'Start Recording'}
                    </button>
                    <button className="end-button" onClick={() => endSession(false)} style={{ fontSize: '3rem' }}>
                        End Session
                    </button>
                </div>
                {/* DEV ONLY: Override Timer Checkbox */}
                <div style={{ marginTop: '20px', textAlign: 'center', color: '#666' }}>
                    <input
                        type="checkbox"
                        id="overrideTimer"
                        checked={overrideTimer}
                        onChange={(e) => setOverrideTimer(e.target.checked)}
                    />
                    <label htmlFor="overrideTimer" style={{ marginLeft: '8px', fontSize: '3rem' }}>Override 2-minute timer (for development)</label>
                </div>
            </div>

            <div className="card status-card">
                <div className="status-indicator">
                    <span className="status-dot" style={{ background: isListening ? '#ef4444' : '#94a3b8' }}></span>
                    <span className="status-text" style={{ fontSize: '3rem' }}>{isListening ? 'Recording...' : 'Ready to Record'}</span>
                </div>
                <p className="total-count" style={{ fontSize: '3rem' }}>Total filler words detected: <strong>{totalFillerWords}</strong></p>
                {error && <p style={{ color: 'red', marginTop: '10px', fontSize: '3rem' }}>{error}</p>}
                {!isSupported && <p style={{ color: 'red', marginTop: '10px', fontSize: '3rem' }}>Speech recognition is not supported in this browser.</p>}
            </div>

            <div style={{ textAlign: 'center', margin: '20px 0' }}>
                <a onClick={() => navigate('/analytics')} style={{ cursor: 'pointer', textDecoration: 'underline', color: '#666', fontSize: '3rem' }}>View Detailed Analytics</a>
            </div>

            <div className="card detection-card">
                <h2>
                    <span className="chart-icon"></span>
                    Filler Word Detection
                </h2>
                <p style={{ fontSize: '3rem' }}>Real-time tracking of common filler words</p>

                <div className="filler-grid">
                    {Object.entries(fillerCounts).map(([word, count], index) => (
                        <div className="filler-item" key={word}>
                            <div className={`filler-count ${colors[index % colors.length]}`} style={{ fontSize: '3rem' }}>{count}</div>
                            <div className="filler-label" style={{ fontSize: '3rem' }}>{formatFillerWord(word)}</div>
                        </div>
                    ))}
                </div>

                <div style={{ marginTop: '30px' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <label htmlFor="customWord" style={{ fontWeight: '500', fontSize: '3rem' }}>custom word</label>
                        <input
                            id="customWord"
                            type="text"
                            value={customWord}
                            onChange={(e) => setCustomWord(e.target.value)}
                            placeholder="Enter word"
                            style={{ padding: '8px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '3rem', maxWidth: '120px' }}
                            maxLength="10"
                        />
                        <button onClick={addCustomWord} className="start-button" style={{ padding: '8px 16px', fontSize: '3rem' }}>Add</button>
                    </div>
                </div>
            </div>

            <div className="card">
                <h2>Live Transcript</h2>
                <div style={{ marginTop: '10px', padding: '10px', border: '1px solid #ddd', borderRadius: '8px', minHeight: '100px', background: '#f8fafc', fontSize: '3rem' }}>
                    {transcript}
                </div>
            </div>
        </div>
    );
};
