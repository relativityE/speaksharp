import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Target, Trophy, Calendar } from 'lucide-react';

import { useAnalytics } from '@/hooks/useAnalytics';
import { Skeleton } from '@/components/ui/skeleton';

export const GoalsSection: React.FC = () => {
    const { loading, error } = useAnalytics(); // In a real app, this would fetch goals data

    if (loading) {
        return (
            <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Target className="h-5 w-5 text-primary" />Current Goals</CardTitle></CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-2 w-full" /></div>
                    <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-2 w-full" /></div>
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Target className="h-5 w-5 text-primary" />Current Goals</CardTitle></CardHeader>
                <CardContent>
                    <p className="text-destructive">Could not load goals.</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5 text-primary" />
                    Current Goals
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                        <span className="font-medium flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            Weekly Sessions
                        </span>
                        <span className="text-muted-foreground">3 / 5</span>
                    </div>
                    <Progress value={60} className="h-2" />
                </div>

                <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                        <span className="font-medium flex items-center gap-2">
                            <Trophy className="h-4 w-4 text-muted-foreground" />
                            Clarity Score Avg
                        </span>
                        <span className="text-muted-foreground">88% / 90%</span>
                    </div>
                    <Progress value={97} className="h-2" />
                </div>

                <div className="pt-2">
                    <p className="text-xs text-muted-foreground text-center">
                        Keep it up! You're on track to reach your weekly targets.
                    </p>
                </div>
            </CardContent>
        </Card>
    );
};
