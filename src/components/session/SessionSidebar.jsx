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

export const SessionSidebar = ({ isListening, error, startListening, stopListening, reset, desiredMode, setMode, actualMode, saveSession, elapsedTime, modelLoadingProgress }) => {
    const navigate = useNavigate();
    const { user, profile } = useAuth();
    const stripe = useStripe();
    const [isLoading, setIsLoading] = useState(false);
    const [isUpgrading, setIsUpgrading] = useState(false);
    const [devCloudUnlocked, setDevCloudUnlocked] = useState(false);

    const isPro = profile?.subscription_status === 'pro' || profile?.subscription_status === 'premium';

    const handleDevCloudUnlockChange = (checked) => {
        if (isListening) {
            toast.info("Mode switching is disabled while recording.", {
                description: "Please stop the current session to switch transcription modes.",
            });
        } else {
            setDevCloudUnlocked(checked);
        }
    };

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
        } else {
            if (error) setIsLoading(false);
        }
    }, [isListening, error]);

    const handleStartStop = () => {
        if (isListening) {
            endSessionAndSave();
        } else {
            setIsLoading(true);
            reset();
            startListening();
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

    const getModeNotification = () => {
        switch (actualMode) {
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
                        <CardTitle className="text-sm">Settings</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <div className={`text-center p-2 rounded-lg ${modeNotification.className}`}>
                            <p className="text-xs">
                                {modeNotification.text}
                            </p>
                        </div>
                        <div className="flex items-center justify-between">
                            <Label htmlFor="transcription-mode" className="text-xs">Transcription Mode</Label>
                            <div className="flex items-center gap-1">
                                <Label htmlFor="transcription-mode" className="text-muted-foreground text-xs">Local</Label>
                                <Switch
                                    id="transcription-mode"
                                    checked={desiredMode === 'cloud'}
                                    onCheckedChange={(checked) => setMode(checked ? 'cloud' : 'local')}
                                    disabled={!isPro && !devCloudUnlocked}
                                />
                                <Label htmlFor="transcription-mode" className="text-muted-foreground flex items-center gap-1 text-xs">
                                     Cloud
                                     {!isPro && <Lock className="w-3 h-3" />}
                                 </Label>
                            </div>
                        </div>
                        <ModelLoadingIndicator progress={modelLoadingProgress} />
                        <ErrorDisplay error={error} />
                        {import.meta.env.DEV && (
                            <div className="pt-2 border-t border-border/50 space-y-2">
                                <h4 className="font-medium text-muted-foreground text-sm">Developer Controls</h4>
                                <div className="flex items-center space-x-1">
                                    <Checkbox id="dev-native-mode" onCheckedChange={(checked) => { if(checked) setMode('native')}} />
                                    <Label htmlFor="dev-native-mode" className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                        Force Native Transcription
                                    </Label>
                                </div>
                                <div className="flex items-center space-x-1">
                                    <Checkbox id="dev-unlock-cloud" checked={devCloudUnlocked} onCheckedChange={handleDevCloudUnlockChange} />
                                    <Label htmlFor="dev-unlock-cloud" className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                        Unlock Cloud Mode (for non-pro)
                                    </Label>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="w-full">
                    <CardContent className="p-6">
                        <div className="flex flex-col items-center justify-center gap-6 py-2">
                            <DigitalTimer elapsedTime={elapsedTime} />
                            <div className={`text-xl font-semibold ${isListening ? 'text-red-500 animate-pulse' : 'text-muted-foreground'}`}>
                                {isLoading
                                    ? (modelLoadingProgress?.status === 'download'
                                        ? `Downloading Model... ${(modelLoadingProgress.loaded / 1024 / 1024).toFixed(1)}MB`
                                        : 'INITIALIZING...')
                                    : (isListening ? '● RECORDING' : 'Idle')
                                }
                            </div>
                            {isLoading && modelLoadingProgress?.status === 'download' && (
                                <Progress value={(modelLoadingProgress.loaded / modelLoadingProgress.total) * 100} className="w-3/4" />
                            )}
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

            <Card className="w-full bg-secondary border-primary/20 flex-shrink-0">
                <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2 text-primary">
                        <Zap className="w-4 h-4" />
                        Upgrade to Pro
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-xs text-muted-foreground mb-2">
                        Get unlimited practice, advanced analytics, and priority support.
                    </p>
                    <Button size="sm" className="w-full font-bold group" variant="outline" onClick={handleUpgrade} disabled={isUpgrading || !user || isPro}>
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
