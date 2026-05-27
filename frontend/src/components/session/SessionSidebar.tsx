import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { useUserProfile } from '@/hooks/useUserProfile';
import { getEffectiveSubscriptionStatus, hasCloudSttEntitlement, isActiveTrialProfile, isPro as checkIsPro } from '@/constants/subscriptionTiers';
import { useUsageLimit } from '@/hooks/useUsageLimit';
import type { TranscriptionPolicy, TranscriptionMode } from '../../services/transcription/TranscriptionPolicy';
import { buildPolicyForUser } from '@/services/transcription/TranscriptionPolicy';
import logger from '../../lib/logger';
import { Mic, Square, Loader2, Cloud, Computer, Lock, Info } from 'lucide-react';
import { toast } from '@/lib/toast';
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
import { ErrorDisplay } from '../ErrorDisplay';
import type { PracticeSession } from '@/types/session';
import { Label } from '@/components/ui/label';

// --- Prop and State Interfaces ---



export interface SessionSidebarProps {
    isListening: boolean;
    isReady: boolean;
    error: Error | null;
    startListening: (policy: TranscriptionPolicy) => Promise<void>;
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


// --- Main Component ---

export const SessionSidebar: React.FC<SessionSidebarProps> = ({ isListening, isReady, error, startListening, stopListening, reset, actualMode, saveSession, startTime, modelLoadingProgress }) => {
    const navigate = useNavigate();
    const { user } = useAuthProvider();
    const { data: profile } = useUserProfile();
    const { data: usageLimit } = useUsageLimit();
    const [isEndingSession, setIsEndingSession] = useState(false);

    const isDevUser = import.meta.env.VITE_DEV_USER === 'true';
    const effectiveSubscriptionStatus = getEffectiveSubscriptionStatus(usageLimit?.subscription_status, profile);
    const isProUser = checkIsPro(effectiveSubscriptionStatus);
    const canUsePrivateStt = isProUser || isActiveTrialProfile(profile) || isDevUser;
    const canAccessAdvancedModes = canUsePrivateStt;
    const isE2EProHarness = import.meta.env.MODE !== 'production' && import.meta.env.VITE_TEST_MODE === 'true' && isProUser;
    const canUseCloudStt = (isProUser && (hasCloudSttEntitlement(profile) || isE2EProHarness)) || isDevUser;

    type Mode = 'cloud' | 'private' | 'native';
    const getDefaultMode = (): Mode => {
        if (isDevUser) return 'cloud';
        if (canAccessAdvancedModes) return 'private';
        return 'native';
    };
    const [selectedMode, setSelectedMode] = useState<Mode>(getDefaultMode);

    const [showEndSessionDialog, setShowEndSessionDialog] = useState(false);
    const [completedSessions, setCompletedSessions] = useState<PracticeSession[]>([]);

    const isModelLoading = modelLoadingProgress !== null;
    const isConnecting = isListening && !isReady;

    useEffect(() => {
        if (!canAccessAdvancedModes && selectedMode !== 'native') {
            setSelectedMode('native');
            return;
        }
        if (selectedMode === 'cloud' && !canUseCloudStt) {
            setSelectedMode(canAccessAdvancedModes ? 'private' : 'native');
        }
    }, [canAccessAdvancedModes, canUseCloudStt, selectedMode]);

    // SYSTEMATIC REFINEMENT: Removed redundant model download toast.
    // Progress notifications are now managed centrally by useSpeechRecognition hook.

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

            // Notify user about Analytics access
            toast.success('Session saved! Click "Analytics" in the header to view detailed insights.', {
                duration: 5000,
                id: 'session-saved-analytics-hint',
            });
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
            // Build policy based on user tier and selected mode
            const requestedMode = canAccessAdvancedModes ? selectedMode : 'native';
            const finalMode = requestedMode === 'cloud' && !canUseCloudStt ? 'private' : requestedMode;
            const policy = buildPolicyForUser(canUsePrivateStt, finalMode as TranscriptionMode, { allowCloud: canUseCloudStt });
            await startListening(policy);
        }
    };

    const ModeIndicator = () => {
        if (!actualMode) return null;
        const isPrivate = actualMode === 'private';
        const modeText = actualMode === 'cloud' ? 'Cloud' : (actualMode === 'native' ? 'Native Browser' : 'Private');
        const Icon = actualMode === 'cloud' ? Cloud : (isPrivate ? Lock : Computer);
        return (
            <Badge variant="outline" className={`flex items-center gap-2 py-1 px-3 ${isPrivate ? 'border-primary/50 bg-primary/5 text-primary' : ''}`}>
                <Icon className="w-4 h-4" />
                <span className="font-semibold">{isPrivate ? 'Vault (Private)' : modeText}</span>
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
                    <ErrorDisplay error={error} />

                    <div className="space-y-2 border-b pb-4">
                        <div className="flex items-center gap-2">
                            <Label className="text-sm font-medium">Transcription Mode</Label>
                            {selectedMode === 'private' && (
                                <span
                                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-primary/30 bg-primary/5 text-primary"
                                    title="On-device and private. First words may take ~5s; nothing leaves your browser."
                                    aria-label="Private transcription details: On-device and private. First words may take about 5 seconds. Nothing leaves your browser."
                                >
                                    <Info className="h-3.5 w-3.5" />
                                </span>
                            )}
                        </div>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="w-full" disabled={isListening || isModelLoading || isConnecting}>
                                    {selectedMode === 'cloud' ? 'Cloud' : selectedMode === 'private' ? 'Private' : 'Native'}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-56">
                                    <DropdownMenuRadioGroup value={selectedMode} onValueChange={(value) => setSelectedMode(value as Mode)}>
                                        <DropdownMenuRadioItem value="private" aria-label="Private" disabled={!canAccessAdvancedModes} className="items-start py-2.5">
                                            <span className="flex flex-col gap-0.5">
                                                <span>Private</span>
                                                <span className="text-xs font-normal text-muted-foreground">
                                                    On-device. First words may take ~5s.
                                                </span>
                                            </span>
                                        </DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="cloud" aria-label="Cloud" disabled={!canUseCloudStt} className="items-start py-2.5">
                                            <span className="flex flex-col gap-0.5">
                                                <span>Cloud (Pro feature)</span>
                                                <span className="text-xs font-normal text-muted-foreground">
                                                    Fastest option. Audio is processed securely in the cloud.
                                                </span>
                                            </span>
                                        </DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="native" aria-label="Native" className="items-start py-2.5">
                                            <span className="flex flex-col gap-0.5">
                                                <span>Native</span>
                                                <span className="text-xs font-normal text-muted-foreground">
                                                    Browser speech service. Works best in Chrome or Edge.
                                                </span>
                                            </span>
                                        </DropdownMenuRadioItem>
                                    </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    <div className="flex flex-col items-center justify-center gap-6 py-2 flex-grow">
                        <DigitalTimer startTime={startTime} />
                        <div data-testid="session-status-indicator" className={`text-xl font-semibold ${isListening && isReady ? 'text-green-500' : (isConnecting || isModelLoading ? 'text-amber-500' : 'text-amber-400')}`}>
                            {isConnecting ? 'Connecting...' : (isListening ? 'Recording' : (isModelLoading ? 'Initializing...' : 'Ready'))}
                        </div>
                        <div className="relative">
                            {/* Pulse Ring Effect when Ready */}
                            {!isListening && !isConnecting && !isModelLoading && (
                                <div className="absolute inset-0 rounded-full bg-primary/30 animate-pulse-ring pointer-events-none" />
                            )}
                            <Button
                                onClick={() => { void handleStartStop(); }}
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

                </CardContent>
            </Card>

            <AlertDialog open={showEndSessionDialog} onOpenChange={setShowEndSessionDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>Session Ended</AlertDialogTitle><AlertDialogDescription>Your session has been processed. What would you like to do next?</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel onClick={() => { void handleStayOnPage(); }}>Stay on Page</AlertDialogCancel><AlertDialogAction asChild><Button onClick={() => { void handleNavigateToAnalytics(); }}>Go to Analytics</Button></AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
