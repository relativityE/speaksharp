import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock, Pause } from 'lucide-react';
import type { PauseMetrics } from '@/services/audio/pauseDetector';

interface PauseMetricsDisplayProps {
    metrics: PauseMetrics;
    isListening: boolean;
}

export const PauseMetricsDisplay: React.FC<PauseMetricsDisplayProps> = ({ metrics, isListening }) => {
    const formatDuration = (seconds: number): string => {
        if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
        return `${seconds.toFixed(1)}s`;
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <Pause className="h-4 w-4" />
                    Pause Analysis
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Total Pauses</p>
                        <p className="text-2xl font-bold">{metrics.totalPauses}</p>
                    </div>
                    <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Per Minute</p>
                        <p className="text-2xl font-bold">{metrics.pausesPerMinute.toFixed(1)}</p>
                    </div>
                </div>

                <div className="border-t pt-3 space-y-2">
                    <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Average
                        </span>
                        <span className="text-sm font-medium">
                            {formatDuration(metrics.averagePauseDuration)}
                        </span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Longest
                        </span>
                        <span className="text-sm font-medium">
                            {formatDuration(metrics.longestPause)}
                        </span>
                    </div>
                </div>

                {isListening && (
                    <p className="text-xs text-muted-foreground italic pt-2">
                        Live tracking... Pauses &gt;500ms are counted.
                    </p>
                )}
            </CardContent>
        </Card>
    );
};
