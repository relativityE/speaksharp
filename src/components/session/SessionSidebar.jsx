import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { Mic, Square, Loader2, Zap, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useStripe } from '@stripe/react-stripe-js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ErrorDisplay } from '../ErrorDisplay';

const DigitalTimer = ({ elapsedTime }) => {
    const minutes = Math.floor(elapsedTime / 60);
    const seconds = elapsedTime % 60;
    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    return (
        <div className="bg-primary text-primary-foreground px-4 py-2 rounded-full shadow-lg">
            <div className="text-2xl font-mono font-bold tracking-widest">
                {formattedTime}
            </div>
        </div>
    );
};

const ModelLoadingIndicator = ({ progress }) => {
    if (!progress || progress.status === 'ready' || progress.status === 'error') {
        return null;
    }

    const loaded = progress.loaded ? (progress.loaded / 1024 / 1024).toFixed(2) : 0;
    const total = progress.total ? (progress.total / 1024 / 1024).toFixed(2) : 0;
    const progressPercent = progress.total ? (progress.loaded / progress.total) * 100 : 0;

    let statusText = 'Initializing...';
    if (progress.status === 'download') {
        statusText = `Downloading model: ${progress.file} (${loaded}MB / ${total}MB)`;
    }

    return (
        <div className="space-y-2 pt-2">
            <p className="text-xs text-muted-foreground text-center">{statusText}</p>
            {progress.status === 'download' && <Progress value={progressPercent} />}
        </div>
    );
};

export const SessionSidebar = ({ isListening, error, startListening, stopListening, reset, actualMode, saveSession, elapsedTime, modelLoadingProgress }) => {
    const navigate = useNavigate();
    const { user, profile } = useAuth();
    const stripe = useStripe();
    const [isLoading, setIsLoading] = useState(false);
    const [isUpgrading, setIsUpgrading] = useState(false);

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
                    priceId: import.meta.env.VITE_STRIPE_PRICE_ID
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
        if (!sessionData) {
            toast.error("Could not process session data. Please try again.");
            return;
        }
        // ... (rest of the function is unchanged)
    };

    const handleStartStop = async () => {
        if (isListening) {
            await endSessionAndSave();
        } else {
            setIsLoading(true);
            reset();
            try {
                await startListening();
            } finally {
                setIsLoading(false);
            }
        }
    };

    const getButtonContent = () => {
        if (isLoading) {
            return <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Initializing...</>;
        }
        if (isListening) {
            return <><Square className="w-4 h-4 mr-2" /> End Session</>;
        }
        return <><Mic className="w-4 h-4 mr-2" /> Start Recording</>;
    };

    const getQualityIndicator = () => {
        switch (actualMode) {
            case 'cloud':
                return {
                    title: 'Mode: Premium Cloud',
                    text: '⚡ Premium Quality',
                    className: 'bg-blue-100 text-blue-800 ring-2 ring-blue-500/50'
                };
            case 'native':
                return {
                    title: 'Mode: Basic Browser',
                    text: '📱 Browser-Based (Basic)',
                    className: 'bg-yellow-100 text-yellow-800 ring-2 ring-yellow-500/50'
                };
            default:
                return null;
        }
    };

    const qualityIndicator = getQualityIndicator();
    const showUpgradeButton = (!isPro && !isUpgrading) || (import.meta.env.DEV && !isUpgrading);

    return (
        <div className="flex flex-col gap-6 h-full">
            <Card className="w-full flex flex-col flex-grow">
                <CardHeader>
                    <CardTitle className="text-sm ring-2 ring-red-500 p-1 rounded-md">
                        {qualityIndicator ? qualityIndicator.title : 'Session Status'}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 flex-grow flex flex-col">
                    {qualityIndicator && (
                        <div className={`text-center p-2 rounded-lg ${qualityIndicator.className}`}>
                            <p className="text-xs font-semibold">
                                {qualityIndicator.text}
                            </p>
                        </div>
                    )}
                    <ModelLoadingIndicator progress={modelLoadingProgress} />
                    <ErrorDisplay error={error} />
                    <div className="flex flex-col items-center justify-center gap-6 py-2 flex-grow">
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
                    {showUpgradeButton && (
                        <div className="mt-auto pt-4 border-t">
                            <div className="flex items-center gap-2 text-primary mb-2">
                                <Zap className="w-4 h-4" />
                                <h4 className="font-semibold text-sm">Upgrade to Pro</h4>
                            </div>
                            <p className="text-xs text-muted-foreground mb-2">
                                Get unlimited practice, advanced analytics, and priority support.
                            </p>
                            <Button size="sm" className="w-full font-bold group" variant="outline" onClick={handleUpgrade} disabled={isUpgrading}>
                                {isUpgrading
                                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Upgrading...</>
                                    : <>Get Unlimited Practice <span className="ml-2 transition-transform duration-200 group-hover:translate-x-1">→</span></>
                                }
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};
