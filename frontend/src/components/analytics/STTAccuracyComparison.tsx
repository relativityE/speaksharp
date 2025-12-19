import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAnalytics } from '@/hooks/useAnalytics';
import { Skeleton } from '@/components/ui/skeleton';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

/**
 * STT Accuracy Comparison Chart
 * 
 * Compares transcription engine accuracy (AssemblyAI vs Whisper vs Browser)
 * against user-provided ground truth transcripts over time.
 * 
 * @deferred Waiting for ground truth transcript input feature
 */
export const STTAccuracyComparison: React.FC = () => {
    const { accuracyData, loading, error } = useAnalytics();

    if (loading) {
        return (
            <Card>
                <CardHeader><CardTitle>STT Accuracy Comparison</CardTitle></CardHeader>
                <CardContent>
                    <Skeleton className="h-[200px] w-full" />
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card>
                <CardHeader><CardTitle>STT Accuracy Comparison</CardTitle></CardHeader>
                <CardContent>
                    <p className="text-destructive">Could not load accuracy data.</p>
                </CardContent>
            </Card>
        );
    }

    const engines = [...new Set(accuracyData.map(d => d.engine))];
    const colors = ['hsl(var(--primary))', 'hsl(var(--secondary))', 'hsl(var(--accent))'];

    return (
        <Card>
            <CardHeader><CardTitle>STT Accuracy Comparison (vs. Ground Truth)</CardTitle></CardHeader>
            <CardContent>
                {accuracyData.length > 1 ? (
                    <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={accuracyData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                            <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize="0.875rem" tickLine={false} axisLine={false} />
                            <YAxis stroke="hsl(var(--muted-foreground))" fontSize="0.875rem" tickLine={false} axisLine={false} domain={[0, 100]} unit="%" />
                            <Tooltip cursor={{ fill: 'hsla(var(--secondary))' }} contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
                            {engines.map((engine, i) => (
                                <Line key={engine} type="monotone" dataKey="accuracy" data={accuracyData.filter(d => d.engine === engine)} name={engine} stroke={colors[i % colors.length]} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <p className="text-muted-foreground text-sm">Provide ground truth transcripts for at least two sessions to see your accuracy trend.</p>
                )}
            </CardContent>
        </Card>
    );
};