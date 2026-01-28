import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Target, Trophy, Calendar } from 'lucide-react';

import { useAnalytics } from '@/hooks/useAnalytics';
import { useGoals } from '@/hooks/useGoals';
import { Skeleton } from '@/components/ui/skeleton';
import { EditGoalsDialog } from './EditGoalsDialog';

export const GoalsSection: React.FC = () => {
    const { sessionHistory, overallStats, loading, error } = useAnalytics();
    const { goals, setGoals } = useGoals();

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

    // Calculate weekly sessions (last 7 days)
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const weeklySessions = sessionHistory?.filter(session => {
        const sessionDate = new Date(session.created_at);
        return sessionDate >= sevenDaysAgo;
    }).length || 0;

    // Use customizable goals from localStorage
    const { weeklyGoal, clarityGoal } = goals;
    const weeklyProgress = Math.min((weeklySessions / weeklyGoal) * 100, 100);

    // Calculate average clarity score from recent sessions
    const avgClarityScore = parseFloat(overallStats?.avgAccuracy || '0');

    const clarityProgress = Math.min((avgClarityScore / clarityGoal) * 100, 100);

    // Determine encouragement message
    const getEncouragementMessage = () => {
        if (weeklySessions >= weeklyGoal && avgClarityScore >= clarityGoal) {
            return "Excellent work! You've crushed your goals this week! 🎉";
        }
        if (weeklySessions >= weeklyGoal) {
            return "Great job on your session frequency! Keep working on clarity.";
        }
        if (avgClarityScore >= clarityGoal) {
            return "Your clarity is outstanding! Try to practice more frequently.";
        }
        if (weeklySessions > 0 || avgClarityScore > 0) {
            return "Keep it up! You're making progress toward your weekly targets.";
        }
        return "Start your first session to begin tracking your progress!";
    };

    return (
        <Card className="bg-card border-border p-6 rounded-xl shadow-sm">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-primary/10 rounded-lg">
                        <Target className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-lg font-semibold text-foreground">Current Goals</CardTitle>
                </div>
                <EditGoalsDialog goals={goals} onSave={setGoals} />
            </div>

            <div className="space-y-6">
                <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                        <span className="font-medium flex items-center gap-2 text-foreground">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            Weekly Sessions
                        </span>
                        <span className="font-bold text-foreground">{weeklySessions} <span className="text-muted-foreground font-normal">/ {weeklyGoal}</span></span>
                    </div>
                    <Progress value={weeklyProgress} className="h-2 bg-muted/50" />
                </div>

                <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                        <span className="font-medium flex items-center gap-2 text-foreground">
                            <Trophy className="h-4 w-4 text-muted-foreground" />
                            Clarity Score Avg
                        </span>
                        <span className="font-bold text-foreground">{avgClarityScore.toFixed(0)}% <span className="text-muted-foreground font-normal">/ {clarityGoal}%</span></span>
                    </div>
                    <Progress value={clarityProgress} className="h-2 bg-muted/50" />
                </div>

                <div className="pt-4 mt-2 border-t border-border/50">
                    <p className={`text-sm text-center font-medium ${weeklySessions >= weeklyGoal ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                        {getEncouragementMessage()}
                    </p>
                </div>
            </div>
        </Card>
    );
};
