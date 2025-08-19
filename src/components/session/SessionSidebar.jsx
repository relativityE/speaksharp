import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { Mic, Square, Loader2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useStripe } from '@stripe/react-stripe-js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ErrorDisplay } from '../ErrorDisplay';

const DigitalTimer = ({ elapsedTime }) => {
    const minutes = Math.floor(elapsedTime / 60);
    const seconds = elapsedTime % 60;
    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    return (
        <div className="bg-primary text-primary-foreground px-8 py-3 rounded-full shadow-lg">
            <div className="text-5xl font-mono font-bold tracking-widest">
                {formattedTime}
            </div>
        </div>
    );
};

export const SessionSidebar = ({ isListening, error, startListening, stopListening, reset, mode, setMode, saveSession }) => {
    const navigate = useNavigate();
    const { user, profile } = useAuth();
    const stripe = useStripe();
    const [elapsedTime, setElapsedTime] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [isUpgrading, setIsUpgrading] = useState(false);
    const timerIntervalRef = useRef(null);

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
        const sessionData = await stopListening();

        if (!sessionData || !sessionData.transcript) {
            toast.error("Could not process session data. Please try again.");
            return;
        }

        const completeSessionData = {
            title: `Practice Session - ${new Date().toLocaleString()}`,
            duration: Math.ceil(elapsedTime),
            total_words: sessionData.total_words,
            filler_words: sessionData.filler_words,
        };

        if (!user) {
            sessionStorage.setItem('anonymousSession', JSON.stringify({
                ...completeSessionData,
                 created_at: new Date().toISOString()
            }));
            navigate('/analytics');
            return;
        }

        if (elapsedTime > 0 && !isPro) {
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

        saveSession(completeSessionData);
        navigate('/analytics');
    };

    useEffect(() => {
        if (isListening) {
            setIsLoading(false);
            timerIntervalRef.current = setInterval(() => {
                setElapsedTime(prev => prev + 1);
            }, 1000);
        } else {
            if (error) setIsLoading(false);
            clearInterval(timerIntervalRef.current);
        }
        return () => clearInterval(timerIntervalRef.current);
    }, [isListening, error]);

    useEffect(() => {
        if(!isListening) {
            setElapsedTime(0);
        }
    }, [isListening]);

    useEffect(() => {
        if (mode === 'local') {
            toast.info("Local Mode is a Demo", {
                description: "This mode uses a sample sentence to demonstrate filler word detection and is not processing your live speech.",
                duration: 8000,
            });
        }
    }, [mode]);

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

    const getModeNotification = () => {
        switch (mode) {
            case 'cloud':
                return {
                    text: 'Cloud Transcription (Highest Accuracy)',
                    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                };
            case 'local':
                return {
                    text: 'Local Transcription (Faster, Private)',
                    className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                };
            case 'native':
                return {
                    text: 'Native Browser Fallback (Lower Accuracy)',
                    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                };
            default:
                return { text: '', className: '' };
        }
    };

    const modeNotification = getModeNotification();

    return (
        <div className="flex flex-col gap-6 h-full">
            <div className="flex-grow flex flex-col gap-6">
                <Card className="w-full">
                    <CardHeader>
                        <CardTitle>Settings</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className={`text-center p-3 rounded-lg ${modeNotification.className}`}>
                            <p>
                                {modeNotification.text}
                            </p>
                        </div>
                        <div className="flex items-center justify-between">
                            <Label htmlFor="transcription-mode">Transcription Mode</Label>
                            <div className="flex items-center gap-2">
                                <Label htmlFor="transcription-mode" className="text-muted-foreground">Local</Label>
                                <Switch
                                    id="transcription-mode"
                                    checked={mode === 'cloud'}
                                    onCheckedChange={(checked) => setMode(checked ? 'cloud' : 'local')}
                                />
                                <Label htmlFor="transcription-mode" className="text-muted-foreground">Cloud</Label>
                            </div>
                        </div>
                        <ErrorDisplay error={error} />
                        {import.meta.env.DEV && (
                            <div className="pt-4 border-t border-border/50">
                                <h4 className="font-medium text-muted-foreground mb-2">Developer Controls</h4>
                                <Button variant="outline" size="sm" onClick={() => setMode('native')} className="h-auto whitespace-normal text-balance">
                                    Force Native Transcription
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="w-full">
                    <CardContent className="p-6">
                        <div className="flex flex-col items-center justify-center gap-6 py-2">
                            <DigitalTimer elapsedTime={elapsedTime} />
                            <div className={`text-xl font-semibold ${isListening ? 'text-red-500 animate-pulse' : 'text-muted-foreground'}`}>
                                {isLoading ? 'INITIALIZING...' : (isListening ? '● RECORDING' : 'Idle')}
                            </div>
                            <Button
                                onClick={handleStartStop}
                                size="lg"
                                variant={isListening ? 'destructive' : 'default'}
                                className="w-full h-16 text-xl font-bold rounded-lg"
                                disabled={isLoading}
                            >
                                {getButtonContent()}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="w-full bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 border-purple-200 flex-shrink-0">
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <Zap className="w-6 h-6 text-yellow-500" />
                        Upgrade to Pro
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">
                        Get unlimited practice, advanced analytics, and priority support.
                    </p>
                    <Button className="w-full font-bold group" onClick={handleUpgrade} disabled={isUpgrading || !user || isPro}>
                        {isUpgrading
                            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Upgrading...</>
                            : isPro
                                ? 'You are a Pro!'
                                : <>Get Unlimited Practice <span className="ml-2 transition-transform duration-200 group-hover:translate-x-1">→</span></>
                        }
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
};
