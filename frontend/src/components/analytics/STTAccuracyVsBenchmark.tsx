import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAnalytics } from '@/hooks/useAnalytics';
import { Skeleton } from '@/components/ui/skeleton';
import { ResponsiveContainer, Legend, Tooltip, BarChart, Bar, CartesianGrid, XAxis, YAxis, ReferenceLine } from 'recharts';

import { useParams } from 'react-router-dom';

// Need to import using absolute root resolving or relative mapping.
import benchmarkDataRaw from '../../../../tests/STT_BENCHMARKS.json';

interface BenchmarkEntry {
    expectedAccuracy?: number | null;
    provider?: string;
    history?: BenchmarkHistoryEntry[];
    webgpu?: BenchmarkVariant;
    cpu?: BenchmarkVariant;
}

interface BenchmarkHistoryEntry {
    ceiling_wer?: number | null;
    ceiling_accuracy_pct?: number | null;
}

interface BenchmarkVariant {
    expectedAccuracy?: number | null;
    provider?: string;
    history?: BenchmarkHistoryEntry[];
}

const STT_BENCHMARKS = benchmarkDataRaw.engines as Record<string, BenchmarkEntry>;

const hasVerifiedBenchmark = (entry?: BenchmarkVariant | BenchmarkEntry): entry is BenchmarkVariant | BenchmarkEntry => {
    if (!entry || typeof entry.expectedAccuracy !== 'number') return false;

    const latest = entry.history?.[entry.history.length - 1];
    if (!latest) return false;

    return typeof latest.ceiling_wer === 'number' && typeof latest.ceiling_accuracy_pct === 'number';
};

const getEngineBenchmark = (engine: string): number | null => {
    // Standardize key (Cloud, Private, Native)
    const key = engine.charAt(0).toUpperCase() + engine.slice(1);
    const entry = STT_BENCHMARKS[key];
    if (!entry) return null;

    // Private has CPU and WebGPU variants. Until session metadata identifies the
    // runtime, do not present a blanket WebGPU/CPU ceiling as authoritative.
    if (key === 'Private') {
        return null;
    }

    if (!hasVerifiedBenchmark(entry)) return null;

    return entry.expectedAccuracy ?? null;
};

/**
 * STT Accuracy Vs Benchmark Chart
 * 
 * Compares the user's dynamic transcription accuracy against the theoretical 
 * ceiling of the active STT engine (Cloud, Private, Native).
 */
export const STTAccuracyVsBenchmark: React.FC = () => {
    const { sessionId } = useParams<{ sessionId: string }>();
    const { accuracyData, sessionHistory, loading, error } = useAnalytics();

    if (loading) {
        return (
            <Card>
                <CardHeader><CardTitle>STT Accuracy vs Benchmark</CardTitle></CardHeader>
                <CardContent>
                    <Skeleton className="h-[250px] w-full" />
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card>
                <CardHeader><CardTitle>STT Accuracy vs Benchmark</CardTitle></CardHeader>
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
        const engine = specificSession.engine;
        const ceiling = getEngineBenchmark(engine);

        if (ceiling === null) {
            return (
                <Card>
                    <CardHeader>
                        <CardTitle>Session STT Accuracy</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex h-[160px] items-center justify-center rounded-xl border-2 border-dashed border-border px-4 text-center text-sm text-muted-foreground">
                            Current WER benchmark evidence is not available for this STT runtime yet.
                        </div>
                        <p className="text-xs text-muted-foreground mt-2 text-center">
                            This session used the <strong>{engine}</strong> engine. Benchmarks appear only after a current WER-backed run exists for the same runtime.
                        </p>
                    </CardContent>
                </Card>
            );
        }

        const data = [
            {
                name: 'Accuracy',
                Session: accuracy,
                Benchmark: ceiling
            }
        ];

        return (
            <Card>
                <CardHeader>
                    <CardTitle>Session Accuracy vs {engine} Benchmark</CardTitle>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={180} minWidth={1} minHeight={1}>
                        <BarChart data={data} layout="vertical" margin={{ top: 20, right: 30, left: 60, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} strokeOpacity={0.2} />
                            <XAxis type="number" domain={[0, 100]} hide />
                            <YAxis dataKey="name" type="category" stroke="hsl(var(--muted-foreground))" fontSize="12px" axisLine={false} tickLine={false} />
                            <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
                            <Legend />
                            <Bar dataKey="Session" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={24} />
                            <Bar dataKey="Benchmark" fill="hsl(var(--secondary))" radius={[0, 4, 4, 0]} barSize={24} />
                            <ReferenceLine x={ceiling} stroke="hsl(var(--destructive))" strokeDasharray="3 3" label={{ position: 'top', value: `Theoretical Max (${ceiling}%)`, fill: 'hsl(var(--destructive))', fontSize: 12 }} />
                        </BarChart>
                    </ResponsiveContainer>
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                        This session used the <strong>{engine}</strong> engine. Its theoretical maximum memory-ceiling is {ceiling}%.
                    </p>
                </CardContent>
            </Card>
        );
    }

    // 2. Dashboard Trend View (Vertical Bars)
    const enrichedData = accuracyData.map(d => ({
        ...d,
        ceiling: getEngineBenchmark(d.engine)
    })).filter(d => d.ceiling !== null);

    return (
        <Card>
            <CardHeader><CardTitle>Dynamic STT Accuracy vs Ceiling</CardTitle></CardHeader>
            <CardContent>
                {enrichedData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250} minWidth={1} minHeight={1}>
                        <BarChart data={enrichedData} margin={{ top: 20, right: 20, left: -20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} vertical={false} />
                            <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize="0.75rem" tickLine={false} axisLine={false} />
                            <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize="0.75rem" tickLine={false} axisLine={false} unit="%" />
                            <Tooltip cursor={{ fill: 'hsla(var(--secondary))' }} contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
                            <Legend wrapperStyle={{ fontSize: '12px' }} />
                            <Bar dataKey="accuracy" name="Session Accuracy" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} barSize={24} />
                            <Bar dataKey="ceiling" name="Theoretical Max" fill="hsl(var(--secondary))" radius={[4, 4, 0, 0]} barSize={24} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm border-2 border-dashed border-border rounded-xl">
                        Provide ground truth transcripts and current WER benchmark runs to compare STT accuracy.
                    </div>
                )}
            </CardContent>
        </Card>
    );
};
