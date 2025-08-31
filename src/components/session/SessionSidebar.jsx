import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { Mic, Square, Loader2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useStripe } from '@stripe/react-stripe-js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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

export const SessionSidebar = ({ isListening, isReady, error, startListening, stopListening, reset, actualMode, saveSession, elapsedTime, modelLoadingProgress }) => {
    const navigate = useNavigate();
    const { user, profile } = useAuth();
    const stripe = useStripe();
    const [isEndingSession, setIsEndingSession] = useState(false);
    const [isUpgrading, setIsUpgrading] = useState(false);
    const [forceCloud, setForceCloud] = useState(false);
    const [showEndSessionDialog, setShowEndSessionDialog] = useState(false);
    const [completedSessionData, setCompletedSessionData] = useState(null);

    const isPro = profile?.subscription_status === 'pro' || profile?.subscription_status === 'premium';
    const isModelLoading = modelLoadingProgress && modelLoadingProgress.status !== 'ready' && modelLoadingProgress.status !== 'error';
    const isConnecting = isListening && !isReady;

    const handleUpgrade = async () => {
        if (!user) {
            navigate('/auth');
            return;
        }
        setIsUpgrading(true);
        try {
            const { data, error } = await supabase.functions.invoke('stripe-checkout', { body: { priceId: import.meta.env.VITE_STRIPE_PRICE_ID } });
            if (error) throw new Error(`Function Error: ${error.message}`);
            const { sessionId } = data;
            const { error: stripeError } = await stripe.redirectToCheckout({ sessionId });
            if (stripeError) {
                console.error("Stripe redirect error:", stripeError.message);
                toast.error(<div className="toast toast-md toast-error">Error: {stripeError.message}</div>);
            }
        } catch (e) {
            console.error("Upgrade process failed:", e);
            toast.error(<div className="toast toast-md toast-error">Could not initiate the upgrade process. Please try again later.</div>);
        } finally {
            setIsUpgrading(false);
        }
    };

    const endSessionAndSave = async () => {
        setIsEndingSession(true);
        try {
            const sessionData = await stopListening();
            if (!sessionData || !sessionData.transcript) {
                toast.error(<div className="toast toast-md toast-error">Session was too short or no speech was detected.</div>);
                return;
            }
            setCompletedSessionData(sessionData);
            setShowEndSessionDialog(true);
        } catch (e) {
            console.error("Error ending session:", e);
            toast.error(<div className="toast toast-md toast-error">An unexpected error occurred while ending the session.</div>);
        } finally {
            setIsEndingSession(false);
        }
    };

    const handleNavigateToAnalytics = async () => {
        if (!completedSessionData) return;

        const sessionWithDuration = {
            ...completedSessionData,
            duration: elapsedTime,
        };

        if (user) {
            const savedSession = await saveSession(sessionWithDuration);
            if (savedSession && savedSession.id) {
                toast.success(<div className="toast toast-md toast-success">Session saved successfully!</div>);
                navigate(`/analytics/${savedSession.id}`);
            } else {
                toast.warning(<div className="toast toast-md toast-warning">Failed to save the session. Your data is safe, please try again.</div>);
            }
        } else {
            toast.info(<div className="toast toast-md toast-info">Session complete. View your results below.</div>);
            navigate('/analytics', { state: { sessionData: sessionWithDuration } });
        }
        setIsEndingSession(false);
    };

    const handleStayOnPage = () => {
        setShowEndSessionDialog(false);
    };

    const handleStartStop = async () => {
        if (isListening) {
            await endSessionAndSave();
        } else {
            reset();
            await startListening({ forceCloud });
        }
    };

    const getCardTitle = () => {
        if (isConnecting) return 'Session Status: Connecting...';
        if (isListening) return `Session Status: ${actualMode === 'cloud' ? 'Cloud AI' : 'Native Browser'}`;
        if (isModelLoading) return 'Session Status: Initializing...';
        return 'Session Status: Ready';
    };

    const isButtonDisabled = isListening ? isEndingSession : (isModelLoading || isConnecting);

    return (
        <div className="flex flex-col gap-6 h-full">
            <Card className="w-full flex flex-col flex-grow">
                <CardHeader>
                    <CardTitle className="text-sm font-bold text-center p-2 rounded-lg bg-card-foreground/5 text-card-foreground shadow-inner">
                        {getCardTitle()}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 flex-grow flex flex-col">
                    <ModelLoadingIndicator progress={modelLoadingProgress} />
                    <ErrorDisplay error={error} />
                    <div className="flex flex-col items-center justify-center gap-6 py-2 flex-grow">
                        <DigitalTimer elapsedTime={elapsedTime} />
                        <div className={`text-xl font-semibold ${isListening && isReady ? 'text-green-500' : 'text-muted-foreground'}`}>
                            {isConnecting ? '○ Connecting...' : (isListening ? '● Listening...' : (isModelLoading ? 'Please wait...' : 'Idle'))}
                        </div>
                        <Button
                            onClick={handleStartStop}
                            size="lg"
                            variant={isListening ? 'destructive' : 'default'}
                            className="w-full h-16 text-xl font-bold rounded-lg"
                            disabled={isButtonDisabled}
                        >
                            {isListening ? <><Square className="w-4 h-4 mr-2" /> Stop Session</> : (isModelLoading || isConnecting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {isConnecting ? 'Connecting...' : 'Initializing...'}</> : <><Mic className="w-4 h-4 mr-2" /> Start Session</>)}
                        </Button>
                    </div>

                    {import.meta.env.DEV && (
                        <div className="mt-auto pt-4 border-t">
                             <Label
                                htmlFor="force-cloud"
                                className="flex items-center gap-2 text-xs text-muted-foreground"
                                onClick={() => {
                                    if (isListening) {
                                        toast.info(<div className="toast toast-md toast-info">This option cannot be changed during an active session.</div>);
                                    }
                                }}
                             >
                                <Checkbox id="force-cloud" checked={forceCloud} onCheckedChange={setForceCloud} disabled={isListening}/>
                                Force Cloud (Disable Fallback)
                            </Label>
                        </div>
                    )}

                    {!isPro && (
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

            <AlertDialog open={showEndSessionDialog} onOpenChange={setShowEndSessionDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Session Ended</AlertDialogTitle>
                        <AlertDialogDescription>
                            Your session has been processed. What would you like to do next?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={handleStayOnPage}>Stay on Page</AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button onClick={handleNavigateToAnalytics}>Go to Analytics</Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
