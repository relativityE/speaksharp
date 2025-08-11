import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, Square, Pause, Plus, Trash2 } from 'lucide-react';

const FillerWordAnalysis = ({ fillerCounts }) => {
    const sortedFillerWords = Object.entries(fillerCounts).sort(([, a], [, b]) => b - a);

    return (
        <div className="card">
            <h3 className="h3" style={{ color: 'var(--color-text-primary)', marginBottom: '16px' }}>Filler Word Analysis</h3>
            <div style={{ spaceY: '12px' }}>
                {sortedFillerWords.length > 0 ? sortedFillerWords.map(([word, count]) => (
                    <div key={word} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
                        <span style={{ textTransform: 'capitalize', color: 'var(--color-text-secondary)' }}>{word}</span>
                        <span style={{ fontWeight: '600', color: 'var(--color-text-primary)' }}>{count}</span>
                    </div>
                )) : (
                    <p className="p" style={{ fontSize: '0.875rem' }}>No filler words detected yet.</p>
                )}
            </div>
        </div>
    );
};

const CustomWords = ({ customWords, setCustomWords }) => {
    const [newWord, setNewWord] = useState('');

    const addWord = () => {
        if (newWord && !customWords.includes(newWord.toLowerCase())) {
            setCustomWords(prev => [...prev, newWord.toLowerCase()]);
            setNewWord('');
        }
    };

    const removeWord = (wordToRemove) => {
        setCustomWords(prev => prev.filter(word => word !== wordToRemove));
    };

    return (
        <div className="card">
            <h3 className="h3" style={{ color: 'var(--color-text-primary)', marginBottom: '16px' }}>Custom Words</h3>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <input
                    type="text"
                    value={newWord}
                    onChange={(e) => setNewWord(e.target.value)}
                    placeholder="Add a word..."
                    style={{ flex: 1, background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '8px', color: 'var(--color-text-primary)' }}
                />
                <button onClick={addWord} className="btn btn-secondary" style={{ padding: '8px' }}><Plus size={16} /></button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {customWords.map(word => (
                    <div key={word} style={{ display: 'flex', alignItems: 'center', background: 'var(--color-bg-primary)', padding: '4px 8px', borderRadius: 'var(--radius)', fontSize: '0.875rem' }}>
                        <span>{word}</span>
                        <button onClick={() => removeWord(word)} style={{ marginLeft: '8px', background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer' }}><Trash2 size={12} /></button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export const SessionSidebar = ({ isListening, transcript, fillerCounts, error, isSupported, startListening, stopListening, reset, customWords, setCustomWords, saveSession }) => {
    const navigate = useNavigate();
    const [elapsedTime, setElapsedTime] = useState(0);
    const [overrideTimer, setOverrideTimer] = useState(false);
    const timerIntervalRef = useRef(null);
    const totalFillerWords = Object.values(fillerCounts).reduce((sum, count) => sum + count, 0);

    const endSessionAndSave = (navigateToAnalytics = false) => {
        stopListening();
        const sessionData = {
            date: new Date().toISOString(),
            duration: elapsedTime,
            fillerCounts: fillerCounts,
            transcript: transcript,
            totalFillerWords: totalFillerWords,
        };
        saveSession(sessionData);
        if (navigateToAnalytics) {
            navigate('/analytics');
        }
    };

    useEffect(() => {
        if (isListening) {
            timerIntervalRef.current = setInterval(() => setElapsedTime(prev => prev + 1), 1000);
            if (elapsedTime >= 120 && !overrideTimer) {
                endSessionAndSave(true);
            }
        } else {
            clearInterval(timerIntervalRef.current);
        }
        return () => clearInterval(timerIntervalRef.current);
    }, [isListening, elapsedTime, overrideTimer]);

    const handleStartStop = () => {
        if (isListening) {
            endSessionAndSave(true);
        } else {
            reset();
            setElapsedTime(0);
            startListening();
        }
    };

    const formatTime = (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    };

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="card" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '3rem', fontFamily: 'var(--font-primary)', fontWeight: '700', color: 'var(--color-text-primary)' }}>
                    {formatTime(elapsedTime)}
                </div>
                <div style={{ color: isListening ? 'var(--color-accent)' : 'var(--color-text-secondary)', marginBottom: '16px' }}>
                    {isListening ? '● Recording' : 'Ready to start'}
                </div>
                <button className="btn btn-primary" onClick={handleStartStop} style={{ width: '100%' }}>
                    {isListening ? <><Square size={16} style={{ marginRight: '8px' }} />Stop & Save Session</> : <><Mic size={16} style={{ marginRight: '8px' }} />Start Recording</>}
                </button>
                 <div style={{ marginTop: '16px' }}>
                    <input
                        type="checkbox"
                        id="overrideTimer"
                        checked={overrideTimer}
                        onChange={(e) => setOverrideTimer(e.target.checked)}
                    />
                    <label htmlFor="overrideTimer" style={{ marginLeft: '8px', fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
                        Override 2-minute timer
                    </label>
                </div>
            </div>

            <FillerWordAnalysis fillerCounts={fillerCounts} />
            <CustomWords customWords={customWords} setCustomWords={setCustomWords} />

            {error && <p style={{ color: 'red', fontSize: '0.875rem' }}>Error: {error}</p>}
            {!isSupported && <p style={{ color: 'red', fontSize: '0.875rem' }}>Speech recognition not supported.</p>}
        </div>
    );
};
