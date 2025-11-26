import React, { useState, useEffect, useRef } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

import posthog from 'posthog-js';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Mic, Square, Play } from 'lucide-react';
import { useAuthProvider } from '../contexts/AuthProvider';
import { useUserProfile } from '@/hooks/useUserProfile';

export const SessionPage: React.FC = () => {
    const { session } = useAuthProvider();
    const { data: profile } = useUserProfile();
    const [customWords] = useState<string[]>([]);
    const startTimeRef = useRef<number | null>(null);

    const speechRecognition = useSpeechRecognition({
        customWords,
        customVocabulary: [],
        session,
        profile
    });

    const { isListening, isReady, transcript, interimTranscript, fillerData, startListening, stopListening } = speechRecognition;
    const [elapsedTime, setElapsedTime] = useState(0);

    useEffect(() => {
        posthog.capture('session_page_viewed');
    }, []);

    useEffect(() => {
        if (isListening) {
            startTimeRef.current = Date.now();
            const interval = setInterval(() => {
                if (startTimeRef.current) {
                    setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
                }
            }, 1000);
            return () => clearInterval(interval);
        } else {
            setElapsedTime(0);
        }
    }, [isListening]);

    const handleStartStop = async () => {
        if (isListening) {
            await stopListening();
        } else {
            await startListening({ forceNative: true });
        }
    };

    const minutes = Math.floor(elapsedTime / 60);
    const seconds = elapsedTime % 60;
    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    const fillerCount = Object.values(fillerData).reduce((sum, data) => sum + data.count, 0);
    const wordCount = transcript.transcript.split(' ').filter(w => w.length > 0).length;
    const wpm = elapsedTime > 0 ? Math.round((wordCount / elapsedTime) * 60) : 0;
    const clarityScore = fillerCount > 0 && wordCount > 0 ? Math.max(0, Math.min(100, 100 - (fillerCount / wordCount * 500))) : 87;

    return (
        <div className="min-h-screen bg-background">
            {/* Page Header */}
            <div className="text-center py-8 px-6">
                <h1 className="text-4xl font-bold text-foreground mb-2">Practice Session</h1>
                <p className="text-muted-foreground">Speak clearly and we'll analyze your speech patterns in real-time</p>
            </div>

            <div className="max-w-7xl mx-auto px-6 pb-12 space-y-6">
                {/* Live Recording Card - Full Width */}
                <div className="bg-card border-2 border-white rounded-lg shadow-[0_4px_20px_-2px_rgba(0,0,0,0.3)]">
                    <div className="p-8">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-semibold text-foreground">Live Recording</h2>
                            <Badge className={isReady ? "bg-orange-500/10 text-orange-500 border-orange-500/20" : "bg-muted/10 text-muted-foreground border-muted/20"} data-testid="session-status-indicator">
                                {isReady ? 'READY' : 'LOADING'}
                            </Badge>
                        </div>

                        <div className="flex flex-col items-center py-12 bg-background/30 rounded-lg border border-white/10">
                            {/* Mic Icon Circle */}
                            <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 ${isListening ? 'bg-red-500/20' : 'bg-primary'}`}>
                                <Mic className={`w-12 h-12 ${isListening ? 'text-red-500' : 'text-white'}`} strokeWidth={2} />
                            </div>

                            {/* Timer */}
                            <div className="text-5xl font-mono font-bold text-foreground mb-2">{formattedTime}</div>
                            <p className="text-muted-foreground mb-8" data-testid="transcript-display">
                                {isListening ? 'Recording in progress...' : 'Click start to begin recording'}
                            </p>

                            {/* Control Button */}
                            <Button
                                onClick={handleStartStop}
                                size="lg"
                                variant={isListening ? 'destructive' : 'default'}
                                className="w-48 h-14 text-lg font-semibold"
                                disabled={!isReady && !isListening}
                                data-testid="session-start-stop-button"
                            >
                                {isListening ? (
                                    <><Square className="w-5 h-5 mr-2" /> Stop</>
                                ) : (
                                    <><Play className="w-5 h-5 mr-2" /> Start</>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Metrics Grid - 2 Columns */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Clarity Score */}
                    <div className="bg-card border-2 border-white rounded-lg p-8 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.3)]">
                        <h3 className="text-lg font-semibold text-foreground mb-6">Clarity Score</h3>
                        <div className="flex flex-col items-center">
                            <div className="text-6xl font-bold text-primary mb-2">{Math.round(clarityScore)}%</div>
                            <p className="text-sm text-muted-foreground">
                                {clarityScore >= 80 ? 'Excellent clarity!' : clarityScore >= 60 ? 'Good clarity' : 'Keep practicing'}
                            </p>
                        </div>
                    </div>

                    {/* Speaking Rate */}
                    <div className="bg-card border-2 border-white rounded-lg p-8 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.3)]">
                        <h3 className="text-lg font-semibold text-foreground mb-6">Speaking Rate</h3>
                        <div className="flex flex-col items-center">
                            <div className="text-6xl font-bold text-primary mb-2">{wpm}</div>
                            <p className="text-sm text-muted-foreground mb-3">words per minute</p>
                            <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20">
                                {wpm >= 120 && wpm <= 160 ? 'Optimal Range' : wpm > 160 ? 'Too Fast' : wpm < 60 ? '' : 'Too Slow'}
                            </Badge>
                        </div>
                    </div>

                    {/* Filler Words */}
                    <div className="bg-card border-2 border-white rounded-lg p-8 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.3)]">
                        <div className="flex items-center gap-2 mb-6">
                            <div className="w-2 h-2 rounded-full bg-orange-500"></div>
                            <h3 className="text-lg font-semibold text-foreground">Filler Words</h3>
                        </div>
                        <div className="flex flex-col items-center mb-4">
                            <div className="text-5xl font-bold text-orange-500 mb-2">{fillerCount}</div>
                            <p className="text-sm text-muted-foreground">detected this session</p>
                        </div>
                        <div className="mt-4">
                            <p className="text-xs text-muted-foreground mb-2">Recent:</p>
                            <div className="flex flex-wrap gap-2">
                                {Object.entries(fillerData).map(([word, data]) => (
                                    data.count > 0 && (
                                        <Badge key={word} variant="secondary" className="text-xs">
                                            "{word}"
                                        </Badge>
                                    )
                                ))}
                                {fillerCount === 0 && (
                                    <p className="text-xs text-muted-foreground italic">None detected yet</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Speaking Tips */}
                    <div className="bg-card border-2 border-white rounded-lg p-8 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.3)]">
                        <div className="flex items-center gap-2 mb-6">
                            <div className="w-1 h-6 bg-primary rounded"></div>
                            <h3 className="text-lg font-semibold text-foreground">Speaking Tips</h3>
                        </div>
                        <div className="space-y-4">
                            <SpeakingTipCard
                                title="Pace Yourself"
                                description="Maintain 120-160 words per minute for optimal clarity"
                            />
                            <SpeakingTipCard
                                title="Pause Instead"
                                description="Use intentional pauses instead of filler words"
                            />
                            <SpeakingTipCard
                                title="Practice Daily"
                                description="Regular practice builds confident speaking habits"
                            />
                        </div>
                    </div>

                    {/* Live Transcript Display */}
                    <div className="bg-card border-2 border-white rounded-lg p-8 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.3)] md:col-span-2" data-testid="transcript-panel">
                        <div className="flex items-center gap-2 mb-6">
                            <div className="w-1 h-6 bg-primary rounded"></div>
                            <h3 className="text-lg font-semibold text-foreground">Live Transcript</h3>
                        </div>
                        <div className="min-h-[120px] max-h-[300px] overflow-y-auto p-4 rounded-lg bg-background/50 border border-white/10" data-testid="transcript-container">
                            {isListening && (!transcript.transcript || transcript.transcript.trim() === '') ? (
                                <p className="text-muted-foreground italic animate-pulse">Listening...</p>
                            ) : transcript.transcript && transcript.transcript.trim() !== '' ? (
                                <p className="text-foreground leading-relaxed">{transcript.transcript}</p>
                            ) : (
                                <p className="text-muted-foreground italic">Your spoken words will appear here</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const SpeakingTipCard: React.FC<{ title: string; description: string }> = ({ title, description }) => (
    <div className="p-3 rounded-lg bg-card/80 border border-white/15 shadow-sm">
        <h4 className="font-semibold text-foreground mb-1 text-sm">{title}</h4>
        <p className="text-xs text-muted-foreground">{description}</p>
    </div>
);