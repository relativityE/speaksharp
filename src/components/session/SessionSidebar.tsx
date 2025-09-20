import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { Mic, Square, Loader2, Zap, Cloud, Computer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '../../lib/dateUtils';
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
import type { PracticeSession } from '@/types/session';
import type { CheckedState } from '@radix-ui/react-checkbox';

// --- Prop and State Interfaces ---

interface ModelLoadProgress {
    status: string;
    file?: string;
    loaded?: number;
    total?: number;
}

interface SessionSidebarProps {
    isListening: boolean;
    isReady: boolean;
    error: Error | null;
    startListening: (options: { forceCloud?: boolean; forceOnDevice?: boolean; forceNative?: boolean }) => Promise<void>;
    stopListening: () => Promise<any | null>;
    reset: () => void;
    actualMode: string | null;
    saveSession: (session: Partial<PracticeSession>) => Promise<{ session: PracticeSession | null; usageExceeded: boolean }>;
    elapsedTime: number;
    modelLoadingProgress: ModelLoadProgress | null;
}

interface DigitalTimerProps {
    elapsedTime: number;
}

interface ModelLoadingIndicatorProps {
    progress: ModelLoadProgress | null;
}

// --- Sub-components ---

const DigitalTimer: React.FC<DigitalTimerProps> = ({ elapsedTime }) => {
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

const ModelLoadingIndicator: React.FC<ModelLoadingIndicatorProps> = ({ progress }) => {
    if (!progress || progress.status === 'ready' || progress.status === 'error') {
        return null;
    }
    const loaded = progress.loaded ? (progress.loaded / 1024 / 1024).toFixed(2) : 0;
    const total = progress.total ? (progress.total / 1024 / 1024).toFixed(2) : 0;
    const progressPercent = progress.total && progress.loaded ? (progress.loaded / progress.total) * 100 : 0;
    let statusText = 'Initializing...';
    if (progress.status === 'download') {
        statusText = `Downloading model: ${progress.file} (${loaded}MB / ${total}MB)`;
    }
    return (
        <div className="space-y-2 pt-2" data-testid="model-loading-indicator">
            <p className="text-xs text-muted-foreground text-center">{statusText}</p>
            {progress.status === 'download' && <Progress value={progressPercent} />}
        </div>
    );
};

// --- Main Component ---

export const SessionSidebar: React.FC<SessionSidebarProps> = ({ isListening, isReady, error, startListening, stopListening, reset, actualMode, saveSession, elapsedTime, modelLoadingProgress }) => {
    const navigate = useNavigate();
    const { user, profile } = useAuth();
    const [isEndingSession, setIsEndingSession] = useState(false);

    const isDevUser = import.meta.env.VITE_DEV_USER === 'true';

    const [forceCloud, setForceCloud] = useState(false);
    const [forceOnDevice, setForceOnDevice] = useState(false);
    const [forceNative, setForceNative] = useState(false);

    const [showEndSessionDialog, setShowEndSessionDialog] = useState(false);
    const [completedSessions, setCompletedSessions] = useState<PracticeSession[]>([]);

    const isPro = profile?.subscription_status === 'pro';
    const isModelLoading = modelLoadingProgress && modelLoadingProgress.status !== 'ready' && modelLoadingProgress.status !== 'error';
    const isConnecting = isListening && !isReady;

    const endSessionAndSave = async () => {
        setIsEndingSession(true);
        try {
            const sessionData = await stopListening();
            if (!sessionData || !sessionData.transcript) {
                toast.error("No speech was detected. Session not saved.");
                return;
            }
            const sessionWithMetadata: PracticeSession = {
                ...sessionData,
                id: `session_${Date.now()}`,
                user_id: user?.id || 'anonymous',
                duration: elapsedTime,
                created_at: new Date().toISOString(),
                title: `Session from ${formatDateTime(new Date())}`,
            };
            setCompletedSessions(prev => [...prev, sessionWithMetadata]);
            setShowEndSessionDialog(true);
        } catch (e: any) {
            logger.error({ error: e }, "Error ending session:");
            toast.error("An unexpected error occurred while ending the session.");
        } finally {
            setIsEndingSession(false);
        }
    };

    const handleNavigateToAnalytics = async () => {
        if (completedSessions.length === 0) return;

        if (user && !isDevUser) {
            for (const session of completedSessions) {
                await saveSession(session);
            }
            toast.success(`${completedSessions.length} session(s) saved successfully!`);
            navigate(`/analytics`);
        } else {
            toast.info("Session complete. View your results below.");
            navigate('/analytics', { state: { sessionHistory: completedSessions } });
        }
        setCompletedSessions([]);
        setShowEndSessionDialog(false);
    };

    const handleStayOnPage = async () => {
        if (completedSessions.length === 0) return;

        if (user && !isDevUser) {
            for (const session of completedSessions) {
                await saveSession(session);
            }
            toast.success(`${completedSessions.length} session(s) saved successfully!`);
        }

        setCompletedSessions([]);
        setShowEndSessionDialog(false);
    };

    const handleStartStop = async () => {
        if (isListening) {
            await endSessionAndSave();
        } else {
            reset();
            await startListening({ forceCloud, forceOnDevice, forceNative });
        }
    };

    const handleCheckboxChange = (setter: React.Dispatch<React.SetStateAction<boolean>>, value: CheckedState) => {
        if (typeof value === 'boolean') {
            setter(value);
        }
    };

    const ModeIndicator = () => {
        if (!actualMode) return null;
        const modeText = actualMode === 'cloud' ? 'Cloud AI' : (actualMode === 'native' ? 'Native Browser' : 'On-Device');
        const Icon = actualMode === 'cloud' ? Cloud : Computer;
        return (
            <Badge variant="outline" className="flex items-center gap-2 py-1 px-3">
                <Icon className="w-4 h-4" />
                <span className="font-semibold">{modeText}</span>
            </Badge>
        );
    };

    return (
        <div className="flex flex-col gap-6 h-full" data-testid="session-sidebar">
            <Card className="w-full flex flex-col flex-grow" data-testid="session-sidebar-card">
                <CardHeader>
                     <div className="flex justify-between items-center">
                        <CardTitle className="text-base">Session Mode</CardTitle>
                        <ModeIndicator />
                    </div>
                </CardHeader>
                <CardContent className="space-y-4 flex-grow flex flex-col">
                    <ModelLoadingIndicator progress={modelLoadingProgress} />
                    <ErrorDisplay error={error} />
                    <div className="flex flex-col items-center justify-center gap-6 py-2 flex-grow">
                        <DigitalTimer elapsedTime={elapsedTime} />
                        <div className={`text-xl font-semibold ${isListening && isReady ? 'text-green-500' : 'text-muted-foreground'}`}>
                            {isConnecting ? 'Connecting...' : (isListening ? 'Session Active' : (isModelLoading ? 'Initializing...' : 'Ready'))}
                        </div>
                        <Button onClick={handleStartStop} size="lg" variant={isListening ? 'destructive' : 'default'} className="w-full h-16 text-xl font-bold rounded-lg" disabled={isListening ? isEndingSession : (isModelLoading || isConnecting)} data-testid="session-start-stop-button">
                            {isListening ? <><Square className="w-4 h-4 mr-2" /> Stop Session</> : (isModelLoading || isConnecting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {isConnecting ? 'Connecting...' : 'Initializing...'}</> : <><Mic className="w-4 h-4 mr-2" /> Start Session</>)}
                        </Button>
                    </div>

                    {isDevUser && (
                        <div className="mt-auto pt-4 border-t space-y-2">
                            <div className="text-xs text-muted-foreground font-semibold">Dev Controls</div>
                            <Label htmlFor="force-on-device" className="flex items-center gap-2 text-xs text-muted-foreground" onClick={() => { if (isListening) toast.info("Cannot be changed during an active session."); }}>
                                <Checkbox id="force-on-device" checked={forceOnDevice} onCheckedChange={(checked) => { handleCheckboxChange(setForceOnDevice, checked); if (checked) { setForceCloud(false); setForceNative(false); } }} disabled={isListening}/>
                                Force On-device (WIP)
                            </Label>
                            <Label htmlFor="force-native" className="flex items-center gap-2 text-xs text-muted-foreground" onClick={() => { if (isListening) toast.info("Cannot be changed during an active session."); }}>
                                <Checkbox id="force-native" checked={forceNative} onCheckedChange={(checked) => { handleCheckboxChange(setForceNative, checked); if (checked) { setForceCloud(false); setForceOnDevice(false); } }} disabled={isListening}/>
                                Force Native Browser
                            </Label>
                            <div className="text-xs text-muted-foreground pt-2">User: <span className="font-bold text-foreground">{profile?.subscription_status || (user ? 'free' : 'anonymous')}</span></div>
                        </div>
                    )}
                    {!isPro && (
                        <div className="mt-auto pt-4 border-t">
                            <div className="flex items-center gap-2 text-primary mb-2"><Zap className="w-4 h-4" /><h4 className="font-semibold text-sm">Upgrade to Pro</h4></div>
                            <p className="text-xs text-muted-foreground mb-2">
                                Get unlimited practice, advanced analytics, and priority support.
                            </p>
                            <Button size="sm" className="w-full font-bold group" variant="outline" data-testid="session-sidebar-upgrade-button">
                                Upgrade
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            <AlertDialog open={showEndSessionDialog} onOpenChange={setShowEndSessionDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>Session Ended</AlertDialogTitle><AlertDialogDescription>Your session has been processed. What would you like to do next?</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel onClick={handleStayOnPage}>Stay on Page</AlertDialogCancel><AlertDialogAction asChild><Button onClick={handleNavigateToAnalytics}>Go to Analytics</Button></AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
