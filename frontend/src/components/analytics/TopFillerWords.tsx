import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAnalytics } from '@/hooks/useAnalytics';
import { Skeleton } from '@/components/ui/skeleton';

export const TopFillerWords: React.FC = () => {
    const { topFillerWords, loading, error } = useAnalytics();

    if (loading) {
        return (
            <Card>
                <CardHeader><CardTitle>Top Filler Words</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card>
                <CardHeader><CardTitle>Top Filler Words</CardTitle></CardHeader>
                <CardContent>
                    <p className="text-destructive">Could not load top filler words.</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader><CardTitle>Top Filler Words</CardTitle></CardHeader>
            <CardContent>
                {topFillerWords.length > 0 ? (
                    <ul className="space-y-2">
                        {topFillerWords.map((word, index) => (
                            <li key={index} className="flex justify-between items-center text-sm">
                                <span className="font-medium text-foreground capitalize">{word.word}</span>
                                <span className="text-muted-foreground font-semibold">{word.count} times</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-muted-foreground text-sm">Not enough data to show top filler words.</p>
                )}
            </CardContent>
        </Card>
    );
};