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
import CircularTimer from './CircularTimer';
import { ErrorDisplay } from '../ErrorDisplay';

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

        if (!user) {
            sessionStorage.setItem('anonymousSession', JSON.stringify({
                ...sessionData,
                 created_at: new Date().toISOString()
            }));
            navigate('/analytics');
            return;
        }

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
            <Card className="w-full">
                <CardHeader>
                    <CardTitle className="text-lg">Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
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
                    <div className="text-center p-2 bg-secondary rounded-md">
                        <p className="text-sm text-muted-foreground">
                            {
                                mode === 'cloud' ? 'Using Cloud Transcription (Highest Accuracy)' :
                                mode === 'local' ? 'Using Local Transcription (Faster, Private)' :
                                'Using Native Browser Fallback'
                            }
                        </p>
                    </div>
                    <ErrorDisplay error={error} />
                </CardContent>
            </Card>

            <Card className="text-center w-full">
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

            <Card className="w-full">
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
        </div>
    );
};
