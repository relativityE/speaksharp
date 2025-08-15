import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { Mic, Square, Plus, Trash2, Loader2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStripe } from '@stripe/react-stripe-js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
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

const FillerWordAnalysis = ({ fillerData, customWords, setCustomWords }) => {
    const sortedFillerWords = Object.entries(fillerData).sort(([, a], [, b]) => b.count - a.count);
    const maxCount = Math.max(...Object.values(fillerData).map(d => d.count), 0);

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
            <CardHeader className="p-4">
                <CardTitle className="text-lg">Filler Word Analysis</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
                {sortedFillerWords.length > 0 ? sortedFillerWords.map(([word, data]) => (
                    <FillerWordCounter key={word} word={word} data={data} maxCount={maxCount} />
                )) : (
                    <p className="text-muted-foreground">Start speaking to see your analysis.</p>
                )}

                <Separator className="my-4" />

                <div className="space-y-3">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-medium text-muted-foreground">Custom Words</h4>
                                    <Badge variant="outline">PRO</Badge>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Track words or phrases unique to your vocabulary. <br />This is a Pro feature.</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <p className="text-xs text-muted-foreground -mt-2">
                        Define your own filler words to get a more personalized analysis.
                    </p>
                    <div className="flex gap-2">
                        <Input
                            type="text"
                            value={newWord}
                            onChange={(e) => setNewWord(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Add a word to track..."
                            className="bg-input"
                        />
                        <Button onClick={addWord} variant="secondary" size="icon">
                            <Plus size={16} />
                        </Button>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2">
                        {customWords.map(word => (
                            <Badge key={word} variant="secondary" className="flex items-center gap-2">
                                <span>{word}</span>
                                <button onClick={() => removeWord(word)} className="text-muted-foreground hover:text-foreground">
                                    <Trash2 size={12} />
                                </button>
                            </Badge>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

export const SessionSidebar = ({ isListening, transcript, fillerData, error, isSupported, startListening, stopListening, reset, customWords, setCustomWords, saveSession, mode, setMode }) => {
    const navigate = useNavigate();
    const { user, profile } = useAuth();
    const stripe = useStripe();
    const [elapsedTime, setElapsedTime] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [isUpgrading, setIsUpgrading] = useState(false);
    const timerIntervalRef = useRef(null);

    const usageInSeconds = profile?.usage_seconds || 0;
    const isPro = profile?.subscription_status === 'pro' || profile?.subscription_status === 'premium';

    const handleUpgrade = async () => {
        if (!user) {
            navigate('/auth');
            return;
        }

        setIsUpgrading(true);
        try {
            const { data, error } = await supabase.functions.invoke('stripe-checkout', {
                body: {
                    // TODO: Replace with your actual Price ID from your Stripe Dashboard
                    priceId: 'price_1PLaAkG16YUfbOlV9Vp2I50b'
                },
            });

            if (error) {
                throw new Error(`Function Error: ${error.message}`);
            }

            const { sessionId } = data;
            const { error: stripeError } = await stripe.redirectToCheckout({ sessionId });

            if (stripeError) {
                console.error("Stripe redirect error:", stripeError.message);
                alert(`Error: ${stripeError.message}`);
            }
        } catch (e) {
            console.error("Upgrade process failed:", e);
            alert("Could not initiate the upgrade process. Please try again later.");
        } finally {
            setIsUpgrading(false);
        }
    };

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

        // Only update usage for free users
        if (elapsedTime > 0 && user && !isPro) {
            const { data: updateSuccess, error: rpcError } = await supabase.rpc('update_user_usage', {
                session_duration_seconds: Math.ceil(elapsedTime)
            });

            if (rpcError) {
                console.error("Error updating user usage:", rpcError);
                toast.error("Could not save session usage. Please contact support.");
            } else if (!updateSuccess) {
                toast.error("You've exceeded your free monthly limit.", {
                    description: "Your session was saved, but usage could not be updated. Please upgrade to a Pro plan for unlimited practice.",
                    action: {
                        label: "Upgrade",
                        onClick: () => handleUpgrade(),
                    },
                });
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
            // Also stop loading if an error occurs
            if (error) setIsLoading(false);
            clearInterval(timerIntervalRef.current);
        }
        return () => clearInterval(timerIntervalRef.current);
    }, [isListening, error]);

    useEffect(() => {
        if(!isListening) {
            setElapsedTime(0);
        }
    }, [isListening])

    const handleStartStop = () => {
        if (isListening) {
            endSessionAndSave();
        } else {
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
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Settings</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between">
                        <Label htmlFor="transcription-mode">Transcription Mode</Label>
                        <div className="flex items-center gap-2">
                            <Label htmlFor="transcription-mode" className="text-sm text-muted-foreground">Local</Label>
                            <Switch
                                id="transcription-mode"
                                checked={mode === 'cloud'}
                                onCheckedChange={(checked) => setMode(checked ? 'cloud' : 'local')}
                            />
                            <Label htmlFor="transcription-mode" className="text-sm text-muted-foreground">Cloud</Label>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card className="text-center max-w-xs mx-auto">
                <CardContent className="p-2">
                    <div className="mb-1">
                        <CircularTimer elapsedTime={elapsedTime} />
                    </div>
                    <div className={`mb-2 font-semibold ${isListening ? 'text-primary' : 'text-muted-foreground'}`}>
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

            <FillerWordAnalysis fillerData={fillerData} customWords={customWords} setCustomWords={setCustomWords} />

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Upgrade to Pro</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground mb-4">
                        Unlock unlimited practice time, advanced analytics, and more.
                    </p>
                    <Button className="w-full" onClick={handleUpgrade} disabled={isUpgrading || !user || isPro}>
                        {isUpgrading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Upgrading...</> : isPro ? 'You are a Pro!' : <><Zap className="w-4 h-4 mr-2" /> Upgrade Now</>}
                    </Button>
                </CardContent>
            </Card>

            {error && <p className="text-destructive">Error: {error}</p>}
            {!isSupported && <p className="text-destructive">Speech recognition not supported in this browser.</p>}
        </div>
    );
};
