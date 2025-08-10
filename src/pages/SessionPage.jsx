import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export const SessionPage = () => {
    const navigate = useNavigate();
    const [isRecording, setIsRecording] = useState(false);
    const [startTime, setStartTime] = useState(null);
    const [elapsedTime, setElapsedTime] = useState(0);
    const [fillerCounts, setFillerCounts] = useState({
        'Um': 0, 'Uh': 0, 'Like': 0, 'You Know': 0, 'So': 0, 'Actually': 0, 'Ah': 0, 'I mean': 0
    });
    const [customWord, setCustomWord] = useState('');
    const [overrideTimer, setOverrideTimer] = useState(false);

    const timerIntervalRef = useRef(null);
    const detectionTimeoutRef = useRef(null);

    const totalFillerWords = Object.values(fillerCounts).reduce((sum, count) => sum + count, 0);

    const updateTimer = () => {
        if (startTime) {
            const currentElapsedTime = Math.floor((Date.now() - startTime) / 1000);
            setElapsedTime(currentElapsedTime);

            if (currentElapsedTime >= 120 && !overrideTimer) {
                endSession(true);
            }
        }
    };

    const stopRecording = () => {
        setIsRecording(false);
        if (detectionTimeoutRef.current) {
            clearTimeout(detectionTimeoutRef.current);
        }
    };

    const startRecording = () => {
        if (!isRecording) {
            setIsRecording(true);
            setStartTime(Date.now());
        } else {
            stopRecording();
        }
    };

    const endSession = (shouldNavigateToAnalytics = false) => {
        stopRecording();
        const sessionData = {
            id: Date.now(),
            date: new Date().toISOString(),
            duration: elapsedTime,
            fillerCounts: fillerCounts,
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

    const simulateFillerDetection = () => {
        if(!isRecording) return;
        const fillers = Object.keys(fillerCounts);
        const randomFiller = fillers[Math.floor(Math.random() * fillers.length)];

        setFillerCounts(prevCounts => ({
            ...prevCounts,
            [randomFiller]: prevCounts[randomFiller] + 1
        }));

        detectionTimeoutRef.current = setTimeout(simulateFillerDetection, Math.random() * 3000 + 1000);
    };

    const addCustomWord = () => {
        if (customWord && !fillerCounts.hasOwnProperty(customWord)) {
            setFillerCounts(prevCounts => ({
                ...prevCounts,
                [customWord]: 0
            }));
            setCustomWord('');
        }
    };

    useEffect(() => {
        if (isRecording) {
            timerIntervalRef.current = setInterval(updateTimer, 1000);
            simulateFillerDetection();
        } else {
            clearInterval(timerIntervalRef.current);
            if (detectionTimeoutRef.current) {
                clearTimeout(detectionTimeoutRef.current);
            }
        }
        return () => {
            clearInterval(timerIntervalRef.current);
            if (detectionTimeoutRef.current) {
                clearTimeout(detectionTimeoutRef.current);
            }
        }
    }, [isRecording, startTime, overrideTimer]);

    useEffect(() => {
        // Add hover effects for cards
        const cards = document.querySelectorAll('.session-page .card');
        const handleMouseEnter = (e) => {
            if (!e.currentTarget.classList.contains('session-card')) {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.12)';
            }
        };
        const handleMouseLeave = (e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 16px rgba(0, 0, 0, 0.08)';
        };
        cards.forEach(card => {
            card.addEventListener('mouseenter', handleMouseEnter);
            card.addEventListener('mouseleave', handleMouseLeave);
        });

        return () => {
            cards.forEach(card => {
                card.removeEventListener('mouseenter', handleMouseEnter);
                card.removeEventListener('mouseleave', handleMouseLeave);
            });
        };
    }, []);

    const formatTime = (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    };

    const colors = ['blue', 'green', 'orange', 'purple', 'red', 'pink', 'teal', 'yellow'];

    return (
        <div className="container session-page">
            <div className="header">
                <h1>SayLess AI</h1>
                <p>Real-time filler word detection for better speaking</p>
            </div>

            <div className="card session-card">
                <div className="timer">{formatTime(elapsedTime)}</div>
                <h2>
                    <span className="microphone-icon"></span>
                    Session Control
                </h2>
                <p>Start recording to begin tracking your speech patterns. The session will end automatically after 2 minutes.</p>
                <div className="button-group">
                    <button className="start-button" onClick={startRecording}>
                        {isRecording ? 'Stop Recording' : 'Start Recording'}
                    </button>
                    <button className="end-button" onClick={() => endSession(false)}>
                        End Session
                    </button>
                </div>
                {/* DEV ONLY: Override Timer Checkbox */}
                <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '12px', color: '#666' }}>
                    <input
                        type="checkbox"
                        id="overrideTimer"
                        checked={overrideTimer}
                        onChange={(e) => setOverrideTimer(e.target.checked)}
                    />
                    <label htmlFor="overrideTimer" style={{ marginLeft: '8px' }}>Override 2-minute timer (for development)</label>
                </div>
            </div>

            <div className="card status-card">
                <div className="status-indicator">
                    <span className="status-dot" style={{ background: isRecording ? '#ef4444' : '#94a3b8' }}></span>
                    <span className="status-text">{isRecording ? 'Recording...' : 'Ready to Record'}</span>
                </div>
                <p className="total-count">Total filler words detected: <strong>{totalFillerWords}</strong></p>
            </div>

            <div style={{ textAlign: 'center', margin: '20px 0' }}>
                <a onClick={() => navigate('/analytics')} style={{ cursor: 'pointer', textDecoration: 'underline', color: '#666' }}>View Detailed Analytics</a>
            </div>

            <div className="card detection-card">
                <h2>
                    <span className="chart-icon"></span>
                    Filler Word Detection
                </h2>
                <p>Real-time tracking of common filler words</p>

                <div className="filler-grid">
                    {Object.entries(fillerCounts).map(([word, count], index) => (
                        <div className="filler-item" key={word}>
                            <div className={`filler-count ${colors[index % colors.length]}`}>{count}</div>
                            <div className="filler-label">{word}</div>
                        </div>
                    ))}
                </div>

                <div style={{ marginTop: '30px' }}>
                    <label htmlFor="customWord" style={{ display: 'block', textAlign: 'left', marginBottom: '10px', fontWeight: '500' }}>Custom word</label>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <input
                            id="customWord"
                            type="text"
                            value={customWord}
                            onChange={(e) => setCustomWord(e.target.value)}
                            placeholder="Enter word"
                            style={{ padding: '8px', borderRadius: '8px', border: '1px solid #ddd', flexGrow: 1, fontSize: '14px' }}
                            maxLength="10"
                        />
                        <button onClick={addCustomWord} className="end-button" style={{ padding: '8px 16px' }}>+</button>
                    </div>
                </div>
            </div>

            <div className="features-grid">
                <div className="card feature-card">
                    <h3>Privacy First</h3>
                    <p>All processing happens on your device using browser APIs. Your speech never leaves your device.</p>
                </div>

                <div className="card feature-card">
                    <h3>Real-time Feedback</h3>
                    <p>Get instant feedback on your speech patterns to improve your communication skills.</p>
                </div>
            </div>
        </div>
    );
};
