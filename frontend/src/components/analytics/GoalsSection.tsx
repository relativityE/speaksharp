import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
            <Card data-testid="goals-section">
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

    const isGoalMet = weeklySessions >= weeklyGoal && avgClarityScore >= clarityGoal;

    return (
        <div
            data-testid="goals-section"
            className={`glass rounded-2xl p-6 ${isGoalMet ? 'glass-strong glow-secondary border-secondary/20' : ''}`}
        >
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary/15 rounded-xl flex items-center justify-center text-primary">
                        <Target className="h-5 w-5" />
                    </div>
                    <h3 className="text-lg font-bold text-foreground">Practice Goals</h3>
                </div>
                <EditGoalsDialog goals={goals} onSave={setGoals} />
            </div>

            <div className="space-y-8">
                <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm">
                        <span className="font-semibold flex items-center gap-2 text-foreground uppercase tracking-wider text-[10px]">
                            <Calendar className="h-3 w-3 text-muted-foreground" />
                            Weekly Sessions
                        </span>
                        <span className="font-bold text-foreground" data-testid="weekly-sessions-value">{weeklySessions} <span className="text-muted-foreground font-medium">/ {weeklyGoal}</span></span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary rounded-full transition-all duration-500"
                            style={{ width: `${weeklyProgress}%` }}
                        />
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm">
                        <span className="font-semibold flex items-center gap-2 text-foreground uppercase tracking-wider text-[10px]">
                            <Trophy className="h-3 w-3 text-muted-foreground" />
                            Clarity Avg
                        </span>
                        <span className="font-bold text-foreground" data-testid="clarity-avg-value">{avgClarityScore.toFixed(0)}% <span className="text-muted-foreground font-medium">/ {clarityGoal}%</span></span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-secondary rounded-full transition-all duration-500"
                            style={{ width: `${clarityProgress}%` }}
                        />
                    </div>
                </div>

                <div className="pt-6 mt-4 border-t border-white/5">
                    <p className={`text-sm text-center font-medium ${weeklySessions >= weeklyGoal ? 'text-secondary' : 'text-muted-foreground'}`}>
                        {getEncouragementMessage()}
                    </p>
                </div>
            </div>
        </div>
    );
};
