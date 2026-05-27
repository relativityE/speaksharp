import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock, Pause } from 'lucide-react';
import type { PauseMetrics } from '@/services/audio/pauseDetector';

interface PauseMetricsDisplayProps {
    metrics: PauseMetrics;
    className?: string;
}

export const PauseMetricsDisplay: React.FC<PauseMetricsDisplayProps> = ({ metrics, className = "" }) => {
    const formatDuration = (seconds: number): string => {
        if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
        return `${seconds.toFixed(1)}s`;
    };
    const explanation = metrics.totalPauses === 0
        ? 'No measurable pauses yet.'
        : metrics.pausesPerMinute > 12
            ? 'Pause rate is high; combine small hesitations into fewer intentional pauses.'
            : metrics.averagePauseDuration >= 0.6 && metrics.averagePauseDuration <= 2.5
                ? 'Pause length is in a useful range for emphasis and breathing.'
                : 'Pause timing is measurable; use it with filler count to judge delivery rhythm.';

    return (
        <Card className={`flex flex-col justify-center compact-density ${className}`}>
            <CardHeader className="p-4 py-2 pb-0">
                <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
                    <Pause className="h-4 w-4" />
                    Pause Analysis
                </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-2 space-y-3">
                <div className="grid grid-cols-2 gap-x-6">
                    <div className="flex items-baseline gap-2">
                        <span className="text-sm text-muted-foreground font-medium">Total Pauses</span>
                        <span className="text-2xl font-bold font-mono text-foreground">{metrics.totalPauses}</span>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-sm text-muted-foreground font-medium">Per Minute</span>
                        <span className="text-2xl font-bold font-mono text-foreground">{metrics.pausesPerMinute.toFixed(1)}</span>
                    </div>
                </div>

                <div className="flex justify-between items-center text-sm border-t border-border pt-3 mt-1">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        Average: <span className="text-foreground font-bold">{formatDuration(metrics.averagePauseDuration)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        Longest: <span className="text-foreground font-bold">{formatDuration(metrics.longestPause)}</span>
                    </div>
                </div>
                <p className="text-xs text-muted-foreground leading-snug" data-testid="pause-explanation">
                    {explanation}
                </p>
            </CardContent>
        </Card>
    );
};
