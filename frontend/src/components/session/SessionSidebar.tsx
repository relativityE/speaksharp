import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { useUserProfile } from '@/hooks/useUserProfile';
import { isPro as checkIsPro } from '@/constants/subscriptionTiers';
import logger from '@/lib/logger';
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from '@/components/ui/progress';
import { ErrorDisplay } from '../ErrorDisplay';
import type { PracticeSession } from '@/types/session';
import { Label } from '@/components/ui/label';

// --- Prop and State Interfaces ---



export interface SessionSidebarProps {
    isListening: boolean;
    isReady: boolean;
    error: Error | null;
    startListening: (options: { forceCloud?: boolean; forceOnDevice?: boolean; forceNative?: boolean }) => Promise<void>;
    stopListening: () => Promise<Partial<PracticeSession> | null>;
    reset: () => void;
    actualMode: string | null;
    saveSession: (session: Partial<PracticeSession>) => Promise<{ session: PracticeSession | null; usageExceeded: boolean }>;
    startTime: number | null;
    modelLoadingProgress: number | null;
}

interface DigitalTimerProps {
    startTime: number | null;
}

interface ModelLoadingIndicatorProps {
    progress: number | null;
}

// --- Sub-components ---

const DigitalTimerComponent: React.FC<DigitalTimerProps> = ({ startTime }) => {
    const [elapsedTime, setElapsedTime] = useState(0);

    useEffect(() => {
        if (startTime === null) {
            setElapsedTime(0);
            return;
        }

        const interval = setInterval(() => {
            const now = Date.now();
            const elapsed = Math.floor((now - startTime) / 1000);
            setElapsedTime(elapsed);
        }, 1000);

        return () => clearInterval(interval);
    }, [startTime]);

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
const DigitalTimer = React.memo(DigitalTimerComponent);

const ModelLoadingIndicator: React.FC<ModelLoadingIndicatorProps> = ({ progress }) => {
    if (progress === null) {
        return null;
    }
    const percentage = Math.round(progress * 100);
    return (
        <div className="space-y-2 pt-2" data-testid="model-loading-indicator">
            <p className="text-xs text-muted-foreground text-center">Downloading model... {percentage}%</p>
            <Progress value={percentage} />
        </div>
    );
};

// --- Main Component ---

export const SessionSidebar: React.FC<SessionSidebarProps> = ({ isListening, isReady, error, startListening, stopListening, reset, actualMode, saveSession, startTime, modelLoadingProgress }) => {
    const navigate = useNavigate();
    const { user } = useAuthProvider();
    const { data: profile } = useUserProfile();
    const [isEndingSession, setIsEndingSession] = useState(false);

    const isDevUser = import.meta.env.VITE_DEV_USER === 'true';
    const isProUser = checkIsPro(profile?.subscription_status);
    const canAccessAdvancedModes = isProUser || isDevUser;

    type Mode = 'cloud' | 'on-device' | 'native';
    const [selectedMode, setSelectedMode] = useState<Mode>(canAccessAdvancedModes ? 'cloud' : 'native');

    const [showEndSessionDialog, setShowEndSessionDialog] = useState(false);
    const [completedSessions, setCompletedSessions] = useState<PracticeSession[]>([]);
    const [hasShownDownloadToast, setHasShownDownloadToast] = useState(false);

    const isModelLoading = modelLoadingProgress !== null;
    const isConnecting = isListening && !isReady;

    // Toast notification for model download
    useEffect(() => {
        if (modelLoadingProgress !== null && !hasShownDownloadToast) {
            toast.info("Downloading AI Model", {
                description: "First-time setup may take a few moments (~30MB).",
                duration: 5000,
            });
            setHasShownDownloadToast(true);
        } else if (modelLoadingProgress === null && hasShownDownloadToast) {
            // Reset when loading finishes or is cancelled
            setHasShownDownloadToast(false);
        }
    }, [modelLoadingProgress, hasShownDownloadToast]);

    const endSessionAndSave = async () => {
        setIsEndingSession(true);
        try {
            const sessionData = await stopListening();
            const finalDuration = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;

            // INTEGRATION SAFETY: Guard against 0-second or 0-word sessions
            // We keep the toast notifications as requested by the user.
            const hasWords = sessionData && sessionData.transcript && sessionData.transcript.trim().length > 0;
            const isLongEnough = finalDuration >= 1;

            if (!hasWords || !isLongEnough) {
                const reason = !isLongEnough ? "Session was too short." : "No speech was detected.";
                toast.error(`${reason} Session not saved.`);
                return;
            }

            const sessionWithMetadata: PracticeSession = {
                ...sessionData,
                id: `session_${Date.now()}`,
                user_id: user?.id || 'anonymous',
                duration: finalDuration,
                created_at: new Date().toISOString(),
                title: `Session from ${formatDateTime(new Date())}`,
            };

            // PERSISTENCE RESILIENCE: Save immediately if authenticated
            // This ensures data is saved even if the user closes the tab before clicking the dialog.
            if (user && !user.is_anonymous) {
                await saveSession(sessionWithMetadata);
            }

            setCompletedSessions(prev => [...prev, sessionWithMetadata]);
            setShowEndSessionDialog(true);
        } catch (e: unknown) {
            const error = e instanceof Error ? e : new Error(String(e));
            logger.error({ error: error.message }, "Error ending session:");
            toast.error("Could not stop the session.", {
                description: "An error occurred while trying to finalize your session. Please try again.",
            });
        } finally {
            setIsEndingSession(false);
        }
    };

    const handleNavigateToAnalytics = async () => {
        if (completedSessions.length === 0) return;

        // Note: authenticated sessions are now saved immediately in endSessionAndSave
        if (!user || user.is_anonymous) {
            toast.info("Session complete. View your results below.", { id: 'session-feedback' });
            navigate('/analytics', { state: { sessionHistory: completedSessions } });
        } else {
            navigate(`/analytics`);
        }
        setCompletedSessions([]);
        setShowEndSessionDialog(false);
    };

    const handleStayOnPage = async () => {
        // Note: authenticated sessions are now saved immediately in endSessionAndSave
        setCompletedSessions([]);
        setShowEndSessionDialog(false);
    };

    const handleStartStop = async () => {
        if (isListening) {
            await endSessionAndSave();
        } else {
            reset();
            // Defensively ensure free users can only use native mode
            const finalMode = canAccessAdvancedModes ? selectedMode : 'native';
            await startListening({
                forceCloud: finalMode === 'cloud',
                forceOnDevice: finalMode === 'on-device',
                forceNative: finalMode === 'native',
            });
        }
    };

    const ModeIndicator = () => {
        if (!actualMode) return null;
        const modeText = actualMode === 'cloud' ? 'Cloud' : (actualMode === 'native' ? 'Native Browser' : 'On-Device');
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
                        <CardTitle className="text-base">Session Controls</CardTitle>
                        <ModeIndicator />
                    </div>
                </CardHeader>
                <CardContent className="space-y-4 flex-grow flex flex-col">
                    <ModelLoadingIndicator progress={modelLoadingProgress} />
                    <ErrorDisplay error={error} />

                    <div className="space-y-2 border-b pb-4">
                        <Label className="text-sm font-medium">Transcription Mode</Label>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="w-full" disabled={isListening || isModelLoading || isConnecting}>
                                    {selectedMode === 'cloud' ? 'Cloud' : selectedMode === 'on-device' ? 'On-Device' : 'Native'}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-56">
                                <DropdownMenuRadioGroup value={selectedMode} onValueChange={(value) => setSelectedMode(value as Mode)}>
                                    <DropdownMenuRadioItem value="cloud" disabled={!canAccessAdvancedModes}>Cloud</DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="on-device" disabled={!canAccessAdvancedModes}>On-Device</DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="native">Native</DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    <div className="flex flex-col items-center justify-center gap-6 py-2 flex-grow">
                        <DigitalTimer startTime={startTime} />
                        <div data-testid="session-status-indicator" className={`text-xl font-semibold ${isListening && isReady ? 'text-green-500' : 'text-muted-foreground'}`}>
                            {isConnecting ? 'Connecting...' : (isListening ? 'Session Active' : (isModelLoading ? 'Initializing...' : 'Ready'))}
                        </div>
                        <div className="relative">
                            {/* Pulse Ring Effect when Ready */}
                            {!isListening && !isConnecting && !isModelLoading && (
                                <div className="absolute inset-0 rounded-full bg-primary/30 animate-pulse-ring pointer-events-none" />
                            )}
                            <Button
                                onClick={handleStartStop}
                                size="lg"
                                variant={isListening ? 'destructive' : 'default'}
                                disabled={isConnecting || (isListening ? isEndingSession : isModelLoading)}
                                data-testid="session-start-stop-button"
                                className={`relative z-10 w-48 h-16 text-lg font-bold rounded-full shadow-xl transition-all duration-300 ${!isListening && 'hover:scale-105'}`}
                            >
                                {isListening ? <><Square className="w-5 h-5 mr-2" /> Stop Session</> : (isModelLoading || isConnecting ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> {isConnecting ? 'Connecting...' : 'Initializing...'}</> : <><Mic className="w-5 h-5 mr-2" /> Start Speaking</>)}
                            </Button>
                        </div>
                    </div>

                    {!isProUser && (
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
