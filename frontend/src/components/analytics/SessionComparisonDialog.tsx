import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { ProgressIndicator } from './ProgressIndicator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface SessionMetrics {
    id: string;
    created_at: string;
    wpm: number;
    clarity_score: number;
    filler_count: number;
    duration_seconds: number;
}

interface SessionComparisonDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sessions: [SessionMetrics, SessionMetrics];
}

export const SessionComparisonDialog: React.FC<SessionComparisonDialogProps> = ({
    open,
    onOpenChange,
    sessions,
}) => {
    const [session1, session2] = sessions;

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    };

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl" aria-label="Session Comparison">
                <DialogHeader>
                    <DialogTitle>Session Comparison</DialogTitle>
                    <DialogDescription>
                        Compare metrics between two practice sessions
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-4 mt-4">
                    {/* Session 1 */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Session 1</CardTitle>
                            <p className="text-sm text-muted-foreground">{formatDate(session1.created_at)}</p>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <div>
                                <span className="text-sm text-muted-foreground">Duration:</span>
                                <span className="ml-2 font-medium">{formatDuration(session1.duration_seconds)}</span>
                            </div>
                            <div>
                                <span className="text-sm text-muted-foreground">WPM:</span>
                                <span className="ml-2 font-medium">{session1.wpm}</span>
                            </div>
                            <div>
                                <span className="text-sm text-muted-foreground">Clarity:</span>
                                <span className="ml-2 font-medium">{session1.clarity_score}%</span>
                            </div>
                            <div>
                                <span className="text-sm text-muted-foreground">Fillers:</span>
                                <span className="ml-2 font-medium">{session1.filler_count}</span>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Session 2 */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Session 2</CardTitle>
                            <p className="text-sm text-muted-foreground">{formatDate(session2.created_at)}</p>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <div>
                                <span className="text-sm text-muted-foreground">Duration:</span>
                                <span className="ml-2 font-medium">{formatDuration(session2.duration_seconds)}</span>
                            </div>
                            <div>
                                <span className="text-sm text-muted-foreground">WPM:</span>
                                <span className="ml-2 font-medium">{session2.wpm}</span>
                            </div>
                            <div>
                                <span className="text-sm text-muted-foreground">Clarity:</span>
                                <span className="ml-2 font-medium">{session2.clarity_score}%</span>
                            </div>
                            <div>
                                <span className="text-sm text-muted-foreground">Fillers:</span>
                                <span className="ml-2 font-medium">{session2.filler_count}</span>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Progress Indicators */}
                <Card className="mt-4">
                    <CardHeader>
                        <CardTitle className="text-base">Progress Analysis</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <ProgressIndicator
                            label="WPM"
                            value={session2.wpm}
                            previousValue={session1.wpm}
                            data-testid="improvement-indicator"
                        />
                        <ProgressIndicator
                            label="Clarity"
                            value={session2.clarity_score}
                            previousValue={session1.clarity_score}
                            unit="%"
                            data-testid="improvement-indicator"
                        />
                        <ProgressIndicator
                            label="Fillers"
                            value={session2.filler_count}
                            previousValue={session1.filler_count}
                            inverse
                            data-testid="improvement-indicator"
                        />
                    </CardContent>
                </Card>
            </DialogContent>
        </Dialog>
    );
};
