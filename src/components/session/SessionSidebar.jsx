import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Mic, Square, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

const FillerWordCounter = ({ word, count }) => {
    const [displayCount, setDisplayCount] = useState(count);
    const [isAnimating, setIsAnimating] = useState(false);

    useEffect(() => {
        if (count !== displayCount) {
            setIsAnimating(true);
            setTimeout(() => {
                setDisplayCount(count);
                setIsAnimating(false);
            }, 300); // Animation duration
        }
    }, [count, displayCount]);

    return (
        <div className="flex items-center justify-between text-sm">
            <span className="capitalize text-muted-text">{word}</span>
            <span className={`font-bold text-light-text transition-colors duration-300 ${isAnimating ? 'text-accent-blue' : ''}`}>
                {displayCount}
            </span>
        </div>
    );
};


const FillerWordAnalysis = ({ fillerCounts }) => {
    const sortedFillerWords = Object.entries(fillerCounts).sort(([, a], [, b]) => b - a);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-xl">Filler Word Analysis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {sortedFillerWords.length > 0 ? sortedFillerWords.map(([word, count]) => (
                    <FillerWordCounter key={word} word={word} count={count} />
                )) : (
                    <p className="text-sm text-muted-text">No filler words detected yet.</p>
                )}
            </CardContent>
        </Card>
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
        <Card>
            <CardHeader>
                <CardTitle className="text-xl">Custom Words</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex gap-2 mb-4">
                    <Input
                        type="text"
                        value={newWord}
                        onChange={(e) => setNewWord(e.target.value)}
                        placeholder="Add a word..."
                        className="bg-charcoal"
                    />
                    <Button onClick={addWord} variant="secondary" size="icon">
                        <Plus size={16} />
                    </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                    {customWords.map(word => (
                        <div key={word} className="flex items-center gap-2 px-2 py-1 text-sm rounded-md bg-charcoal">
                            <span>{word}</span>
                            <button onClick={() => removeWord(word)} className="text-muted-text hover:text-light-text">
                                <Trash2 size={12} />
                            </button>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
};

export const SessionSidebar = ({ isListening, transcript, fillerCounts, error, isSupported, startListening, stopListening, reset, customWords, setCustomWords, saveSession }) => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [elapsedTime, setElapsedTime] = useState(0);
    const [overrideTimer, setOverrideTimer] = useState(false);
    const timerIntervalRef = useRef(null);
    const ANONYMOUS_TIME_LIMIT = 120; // 2 minutes

    const endSessionAndSave = () => {
        stopListening();
        if (!user) {
            // For anonymous users, we don't save, just stop.
            // A modal could be shown here to encourage sign-up.
            return;
        }
        const sessionData = {
            duration: elapsedTime,
            total_words: transcript.split(/\s+/).filter(Boolean).length,
            filler_words: fillerCounts,
            custom_words: customWords.reduce((acc, word) => {
                const regex = new RegExp(`\\b${word}\\b`, 'gi');
                const count = (transcript.match(regex) || []).length;
                if (count > 0) {
                    acc[word] = count;
                }
                return acc;
            }, {}),
        };
        saveSession(sessionData);
        navigate('/analytics');
    };

    useEffect(() => {
        if (isListening) {
            timerIntervalRef.current = setInterval(() => {
                setElapsedTime(prev => {
                    const newTime = prev + 1;
                    if (!user && !overrideTimer && newTime >= ANONYMOUS_TIME_LIMIT) {
                        stopListening();
                    }
                    return newTime;
                });
            }, 1000);
        } else {
            clearInterval(timerIntervalRef.current);
        }
        return () => clearInterval(timerIntervalRef.current);
    }, [isListening, user, stopListening, overrideTimer]);

    const handleStartStop = () => {
        if (isListening) {
            endSessionAndSave();
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

    const timeLimit = user ? null : ANONYMOUS_TIME_LIMIT;

    return (
        <div className="flex flex-col flex-1 gap-6">
            <Card className="text-center">
                <CardContent className="p-6">
                    <div className="text-6xl font-bold font-mono text-light-text">
                        {formatTime(elapsedTime)}
                        {timeLimit && (
                            <span className="text-2xl text-muted-text"> / {formatTime(timeLimit)}</span>
                        )}
                    </div>
                    <div className={`mt-2 mb-4 text-sm ${isListening ? 'text-accent-blue' : 'text-muted-text'}`}>
                        {isListening ? '● Recording' : 'Ready to start'}
                    </div>
                    <Button
                        onClick={handleStartStop}
                        size="lg"
                        className={`w-full ${isListening ? 'bg-red-600 hover:bg-red-700' : 'bg-accent-blue hover:bg-accent-blue/90'} text-white`}
                    >
                        {isListening ? <Square className="w-4 h-4 mr-2" /> : <Mic className="w-4 h-4 mr-2" />}
                        {isListening ? 'End Session' : 'Start Recording'}
                    </Button>
                    {!user && (
                        <div className="flex items-center justify-center mt-4 space-x-2">
                            <Checkbox
                                id="override-timer"
                                checked={overrideTimer}
                                onCheckedChange={setOverrideTimer}
                            />
                            <Label htmlFor="override-timer" className="text-sm text-muted-text">
                                Override 2-min limit (for dev)
                            </Label>
                        </div>
                    )}
                </CardContent>
            </Card>

            <FillerWordAnalysis fillerCounts={fillerCounts} />
            <CustomWords customWords={customWords} setCustomWords={setCustomWords} />

            {error && <p className="text-sm text-red-500">Error: {error}</p>}
            {!isSupported && <p className="text-sm text-red-500">Speech recognition not supported in this browser.</p>}
        </div>
    );
};
