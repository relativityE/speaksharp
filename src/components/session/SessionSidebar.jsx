import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { Mic, Square, Plus, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import CircularTimer from './CircularTimer';

const FillerWordCounter = ({ word, data, maxCount }) => {
    const { count, color } = data;
    const [displayCount, setDisplayCount] = useState(count);
    const [isAnimating, setIsAnimating] = useState(false);
    const progress = maxCount > 0 ? (count / maxCount) * 100 : 0;

    useEffect(() => {
        if (count !== displayCount) {
            setIsAnimating(true);
            setDisplayCount(count);
            const timer = setTimeout(() => setIsAnimating(false), 300); // Animation duration
            return () => clearTimeout(timer);
        }
    }, [count, displayCount]);

    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-muted-foreground">{word}</span>
                </div>
                <span className={`font-bold text-foreground transition-colors duration-300 ${isAnimating ? 'text-primary' : ''}`}>
                    {displayCount}
                </span>
            </div>
            <Progress value={progress} style={{ '--progress-color': color }} className="h-1 [&>div]:bg-[--progress-color]" />
        </div>
    );
};

const FillerWordAnalysis = ({ fillerData }) => {
    const sortedFillerWords = Object.entries(fillerData).sort(([, a], [, b]) => b.count - a.count);
    const maxCount = Math.max(...Object.values(fillerData).map(d => d.count), 0);

    return (
        <Card>
            <CardHeader className="p-4">
                <CardTitle className="text-lg">Filler Word Analysis</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
                {sortedFillerWords.length > 0 ? sortedFillerWords.map(([word, data]) => (
                    <FillerWordCounter key={word} word={word} data={data} maxCount={maxCount} />
                )) : (
                    <p className="text-muted-foreground">Start speaking to see your analysis.</p>
                )}
            </CardContent>
        </Card>
    );
};

const CustomWords = ({ customWords, setCustomWords }) => {
    const [newWord, setNewWord] = useState('');

    const addWord = () => {
        if (newWord && !customWords.includes(newWord.toLowerCase())) {
            setCustomWords(prev => [...prev, newWord.toLowerCase().trim()]);
            setNewWord('');
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            addWord();
        }
    }

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
                        onKeyDown={handleKeyDown}
                        placeholder="Add a word..."
                        className="bg-input"
                    />
                    <Button onClick={addWord} variant="secondary" size="icon">
                        <Plus size={16} />
                    </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                    {customWords.map(word => (
                        <Badge key={word} variant="secondary" className="flex items-center gap-2">
                            <span>{word}</span>
                            <button onClick={() => removeWord(word)} className="text-muted-foreground hover:text-foreground">
                                <Trash2 size={12} />
                            </button>
                        </Badge>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
};

export const SessionSidebar = ({ isListening, transcript, fillerData, error, isSupported, startListening, stopListening, reset, customWords, setCustomWords, saveSession }) => {
    const navigate = useNavigate();
    const { user, profile } = useAuth();
    const [elapsedTime, setElapsedTime] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const timerIntervalRef = useRef(null);

    const FREE_TIER_LIMIT_SECONDS = 300; // 5 minutes
    const usageInSeconds = profile?.usage_seconds || 0;
    const isPro = profile?.subscription_status === 'pro' || profile?.subscription_status === 'premium';
    const remainingTime = isPro ? Infinity : FREE_TIER_LIMIT_SECONDS - usageInSeconds;

    const endSessionAndSave = async () => {
        stopListening();

        const sessionData = {
            duration: elapsedTime,
            transcript: transcript,
            filler_data: fillerData,
            created_at: new Date().toISOString(),
        };

        if (!user) {
            sessionStorage.setItem('anonymousSession', JSON.stringify(sessionData));
            navigate('/analytics');
            return;
        }

        if (elapsedTime > 0) {
            const { error: rpcError } = await supabase.rpc('update_user_usage', { session_duration_seconds: Math.ceil(elapsedTime) });
            if (rpcError) {
                console.error("Error updating user usage:", rpcError);
            }
        }

        saveSession(sessionData);
        navigate('/analytics');
    };

    useEffect(() => {
        if (isListening) {
            setIsLoading(false);
            timerIntervalRef.current = setInterval(() => {
                setElapsedTime(prev => prev + 1);
            }, 1000);
        } else {
            clearInterval(timerIntervalRef.current);
        }
        return () => clearInterval(timerIntervalRef.current);
    }, [isListening]);

    useEffect(() => {
        if (isListening && user && !isPro && elapsedTime >= remainingTime) {
            endSessionAndSave();
            alert("You've reached your free monthly limit. Upgrade to Pro for unlimited practice.");
        }
    }, [isListening, elapsedTime, remainingTime, user, isPro]);


    useEffect(() => {
        if(!isListening) {
            setElapsedTime(0);
        }
    }, [isListening])

    const handleStartStop = () => {
        if (isListening) {
            endSessionAndSave();
        } else {
            if (user && !isPro && remainingTime <= 0) {
                alert("You have used all your free practice time for this month. Please upgrade to a Pro plan for unlimited practice.");
                return;
            }

            setIsLoading(true);
            reset();
            setElapsedTime(0);
            startListening();
        }
    };

    const getButtonContent = () => {
        if (isLoading) {
            return <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Starting...</>;
        }
        if (isListening) {
            return <><Square className="w-4 h-4 mr-2" /> End Session</>;
        }
        return <><Mic className="w-4 h-4 mr-2" /> Start Recording</>;
    };

    return (
        <div className="flex flex-col gap-6">
            <Card className="text-center">
                <CardContent className="p-3">
                    <div className="mb-2">
                        <CircularTimer elapsedTime={elapsedTime} />
                    </div>
                    <div className={`mb-4 font-semibold ${isListening ? 'text-primary' : 'text-muted-foreground'}`}>
                        {isLoading ? 'INITIALIZING...' : (isListening ? '● RECORDING' : '')}
                    </div>
                    <Button
                        onClick={handleStartStop}
                        size="lg"
                        variant={isListening ? 'destructive' : 'default'}
                        className="w-full"
                        disabled={isLoading}
                    >
                        {getButtonContent()}
                    </Button>
                </CardContent>
            </Card>

            <FillerWordAnalysis fillerData={fillerData} />
            <CustomWords customWords={customWords} setCustomWords={setCustomWords} />

            {error && <p className="text-destructive">Error: {error}</p>}
            {!isSupported && <p className="text-destructive">Speech recognition not supported in this browser.</p>}
        </div>
    );
};
