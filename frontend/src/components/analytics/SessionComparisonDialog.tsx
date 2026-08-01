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
    // #1047: transcript-derived metrics are `null` when transcript-state provenance says they are not
    // measured (not_captured / expired-without-persisted). Rendered as N/A, never as a sentinel 0.
    wpm: number | null;
    clarity_score: number | null;
    filler_count: number | null;
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

    // #1047: a null (unmeasured) transcript-derived metric renders as N/A, never a fabricated number.
    const metric = (v: number | null, unit = '') => (v === null ? 'N/A' : `${v}${unit}`);

    // A delta is only shown when BOTH sessions measured the metric; otherwise an honest N/A row.
    const renderDelta = (label: string, value: number | null, previousValue: number | null, opts: { unit?: string; inverse?: boolean } = {}) => {
        if (value === null || previousValue === null) {
            return (
                <div className="flex items-center justify-between" data-testid="improvement-indicator">
                    <span className="text-sm text-muted-foreground">{label}</span>
                    <span className="font-medium">N/A</span>
                </div>
            );
        }
        return (
            <ProgressIndicator
                label={label}
                value={value}
                previousValue={previousValue}
                unit={opts.unit}
                inverse={opts.inverse}
                data-testid="improvement-indicator"
            />
        );
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
                                <span className="ml-2 font-medium">{metric(session1.wpm)}</span>
                            </div>
                            <div>
                                <span className="text-sm text-muted-foreground">Clarity:</span>
                                <span className="ml-2 font-medium">{metric(session1.clarity_score, '%')}</span>
                            </div>
                            <div>
                                <span className="text-sm text-muted-foreground">Fillers:</span>
                                <span className="ml-2 font-medium">{metric(session1.filler_count)}</span>
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
                                <span className="ml-2 font-medium">{metric(session2.wpm)}</span>
                            </div>
                            <div>
                                <span className="text-sm text-muted-foreground">Clarity:</span>
                                <span className="ml-2 font-medium">{metric(session2.clarity_score, '%')}</span>
                            </div>
                            <div>
                                <span className="text-sm text-muted-foreground">Fillers:</span>
                                <span className="ml-2 font-medium">{metric(session2.filler_count)}</span>
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
                        {/* #1047: a delta is only meaningful when BOTH sessions measured the metric. When
                            either side is unmeasured (null), show an honest N/A row instead of a fabricated
                            improvement/regression against a sentinel 0. */}
                        {renderDelta('WPM', session2.wpm, session1.wpm)}
                        {renderDelta('Clarity', session2.clarity_score, session1.clarity_score, { unit: '%' })}
                        {renderDelta('Fillers', session2.filler_count, session1.filler_count, { inverse: true })}
                    </CardContent>
                </Card>
            </DialogContent>
        </Dialog>
    );
};
