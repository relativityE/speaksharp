import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAnalytics } from '@/hooks/useAnalytics';
import { Skeleton } from '@/components/ui/skeleton';
import { Legend, Tooltip, BarChart, Bar, CartesianGrid, XAxis, YAxis } from 'recharts';

import { useParams } from 'react-router-dom';

// Need to import using absolute root resolving or relative mapping.
import { getSessionAnalysisMetrics } from '@/utils/sessionAnalysis';
import { formatSessionRecordingMode } from '@/utils/engineLabels';
import { useChartContainerReady } from './useChartContainerReady';

const ReadyChartFrame: React.FC<{
    height: number;
    children: (size: { width: number; height: number }) => React.ReactNode;
}> = ({ height, children }) => {
    const chartContainer = useChartContainerReady();

    return (
        <div ref={chartContainer.ref} style={{ height }} className="w-full">
            {chartContainer.isReady ? children(chartContainer.size) : (
                <div className="h-full w-full rounded-xl bg-muted/60" aria-hidden="true" />
            )}
        </div>
    );
};

const getEngineQualityData = (sessionHistory: ReturnType<typeof useAnalytics>['sessionHistory']) => {
    const grouped = new Map<string, {
        engine: string;
        clarityTotal: number;
        fillerTotal: number;
        durationTotal: number;
        sessions: number;
    }>();

    sessionHistory.forEach((session) => {
        const engineKey = formatSessionRecordingMode(session);
        const metrics = getSessionAnalysisMetrics(session);
        const current = grouped.get(engineKey) ?? {
            engine: engineKey,
            clarityTotal: 0,
            fillerTotal: 0,
            durationTotal: 0,
            sessions: 0,
        };

        current.clarityTotal += metrics.clarityScore;
        current.fillerTotal += metrics.fillerCount;
        current.durationTotal += session.duration || 0;
        current.sessions += 1;
        grouped.set(engineKey, current);
    });

    return Array.from(grouped.values())
        .map((entry) => {
            const minutes = entry.durationTotal / 60;
            return {
                engine: entry.engine,
                clarity: Math.round(entry.clarityTotal / entry.sessions),
                fillersPerMin: minutes > 0 ? Number((entry.fillerTotal / minutes).toFixed(1)) : 0,
                sessions: entry.sessions,
            };
        })
        .sort((a, b) => b.sessions - a.sessions);
};

/**
 * Customer transcription-quality view. Historical non-Private rows are grouped under one neutral
 * provenance label; raw engines/providers/variants remain internal evidence, never customer copy.
 */
export const STTAccuracyVsBenchmark: React.FC = () => {
    const { sessionId } = useParams<{ sessionId: string }>();
    const { accuracyData, sessionHistory, loading, error } = useAnalytics();

    if (loading) {
        return (
            <Card>
                <CardHeader><CardTitle>Transcription quality</CardTitle></CardHeader>
                <CardContent>
                    <Skeleton className="h-[250px] w-full" />
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card>
                <CardHeader><CardTitle>Transcription quality</CardTitle></CardHeader>
                <CardContent>
                    <p className="text-destructive">Could not load accuracy data.</p>
                </CardContent>
            </Card>
        );
    }

    const specificSession = sessionId ? sessionHistory?.find(s => s.id === sessionId) : null;

    // 1. Session-Specific View (Horizontal Bar)
    if (specificSession && specificSession.ground_truth && specificSession.transcript && specificSession.engine) {
        // accuracyData is already scoped to this session by useAnalytics
        const accuracy = accuracyData[0]?.accuracy || 0;
        const data = [
            {
                name: 'Accuracy',
                Session: accuracy,
            }
        ];

        return (
            <Card>
                <CardHeader>
                    <CardTitle>Session transcription accuracy</CardTitle>
                </CardHeader>
                <CardContent>
                    <ReadyChartFrame height={180}>
                        {(size) => (
                            <BarChart width={size.width} height={size.height} data={data} layout="vertical" margin={{ top: 20, right: 30, left: 60, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} strokeOpacity={0.2} />
                                <XAxis type="number" domain={[0, 100]} hide />
                                <YAxis dataKey="name" type="category" stroke="hsl(var(--muted-foreground))" fontSize="12px" axisLine={false} tickLine={false} />
                                <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
                                <Legend />
                                <Bar dataKey="Session" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={24} />
                            </BarChart>
                        )}
                    </ReadyChartFrame>
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                        Accuracy is shown for this saved take. Internal provider and implementation labels are not customer product modes.
                    </p>
                </CardContent>
            </Card>
        );
    }

    // 2. Dashboard WER Benchmark View (Vertical Bars)
    const engineQualityData = getEngineQualityData(sessionHistory);

    return (
        <Card>
            <CardHeader><CardTitle>Transcription quality</CardTitle></CardHeader>
            <CardContent>
                {engineQualityData.length > 0 ? (
                    <div>
                        <ReadyChartFrame height={250}>
                            {(size) => (
                                <BarChart width={size.width} height={size.height} data={engineQualityData} margin={{ top: 20, right: 20, left: -20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} vertical={false} />
                                    <XAxis dataKey="engine" stroke="hsl(var(--muted-foreground))" fontSize="0.75rem" tickLine={false} axisLine={false} />
                                    <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize="0.75rem" tickLine={false} axisLine={false} unit="%" />
                                    <Tooltip cursor={{ fill: 'hsla(var(--secondary))' }} contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
                                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                                    <Bar dataKey="clarity" name="Avg Clarity" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} barSize={28} />
                                </BarChart>
                            )}
                        </ReadyChartFrame>
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            {engineQualityData.slice(0, 3).map((entry) => (
                                <div key={entry.engine} className="rounded-md border border-border bg-muted/30 px-3 py-2">
                                    <p className="text-sm font-medium text-foreground">{entry.engine}</p>
                                    <p className="text-xs text-muted-foreground">{entry.sessions} session{entry.sessions === 1 ? '' : 's'} · {entry.fillersPerMin} fillers/min</p>
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-3 text-center">
                            Based on saved session metrics. Historical non-Private recordings use one neutral provenance label.
                        </p>
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm border-2 border-dashed border-border rounded-xl">
                        Complete a session to see transcription quality.
                    </div>
                )}
            </CardContent>
        </Card>
    );
};
