import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Target, Trophy, Calendar } from 'lucide-react';

import { useAnalytics } from '@/hooks/useAnalytics';
import { useGoals } from '@/hooks/useGoals';
import { Skeleton } from '@/components/ui/skeleton';
import { EditGoalsDialog } from './EditGoalsDialog';

/**
 * #G4 chunk 3: goal bars rebuilt as **actual-fill + goal-tick**. The old bar filled to
 * progress-toward-goal % (100% = goal), which hid how far past the goal you'd gone and made "on track"
 * indistinguishable from "smashed it". This fills to the ACTUAL value on a fixed scale and marks the goal
 * with a tick, so the bar reads as "here's where you are; here's the line". Fill turns green once the
 * actual value reaches the goal.
 */
const ActualFillBar: React.FC<{ actual: number; goal: number; max: number }> = ({ actual, goal, max }) => {
    const safeMax = Math.max(max, 1);
    const fillPct = Math.min(100, Math.max(0, (actual / safeMax) * 100));
    const goalPct = Math.min(100, Math.max(0, (goal / safeMax) * 100));
    const met = actual >= goal;
    return (
        <div className="relative h-2.5 w-full rounded-full bg-muted/50" data-testid="goal-actual-fill-track">
            <div
                className={`h-full rounded-full transition-all ${met ? 'bg-success' : 'bg-primary'}`}
                style={{ width: `${fillPct}%` }}
                data-testid="goal-actual-fill"
            />
            {/* Goal tick — the line the fill is measured against. */}
            <div
                className="absolute top-1/2 h-3.5 w-[3px] -translate-y-1/2 rounded-full bg-foreground/70"
                style={{ left: `calc(${goalPct}% - 1.5px)` }}
                data-testid="goal-tick"
                aria-hidden="true"
            />
        </div>
    );
};

export const GoalsSection: React.FC = () => {
    const { weeklySessionsCount, overallStats, loading, error } = useAnalytics();
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

    // Use pre-computed weekly session count from useAnalytics
    const weeklySessions = weeklySessionsCount || 0;

    // Use customizable goals from localStorage
    const { weeklyGoal, clarityGoal } = goals;

    // Calculate average clarity score from recent sessions
    const avgClarityScore = typeof overallStats?.avgClarity === 'string'
        ? parseFloat(overallStats.avgClarity)
        : (overallStats?.avgClarity ?? 0);

    // Determine encouragement message
    const getEncouragementMessage = () => {
        if (weeklySessions >= weeklyGoal && avgClarityScore >= clarityGoal) {
            return "Excellent work — you've cleared both goals this week.";
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
        <Card
            data-testid="goals-section"
            className="rounded-xl p-6"
        >
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-primary/10 rounded-lg">
                        <Target className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-lg font-semibold text-foreground">Current Goals</CardTitle>
                </div>
                <EditGoalsDialog goals={goals} onSave={async (g) => { await setGoals(g); }} />
            </div>

            <div className="space-y-6">
                <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                        <span className="font-medium flex items-center gap-2 text-foreground">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            Weekly Sessions
                        </span>
                        <span className="font-bold text-foreground" data-testid="weekly-sessions-value">{weeklySessions} <span className="text-muted-foreground font-normal">/ {weeklyGoal}</span></span>
                    </div>
                    <ActualFillBar actual={weeklySessions} goal={weeklyGoal} max={Math.max(weeklyGoal * 1.5, weeklySessions, 1)} />
                </div>

                <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                        <span className="font-medium flex items-center gap-2 text-foreground">
                            <Trophy className="h-4 w-4 text-muted-foreground" />
                            Clear Delivery Avg
                        </span>
                        <span className="font-bold text-foreground" data-testid="clarity-avg-value">{avgClarityScore.toFixed(0)}% <span className="text-muted-foreground font-normal">/ {clarityGoal}%</span></span>
                    </div>
                    <ActualFillBar actual={avgClarityScore} goal={clarityGoal} max={100} />
                </div>

                <div className="pt-4 mt-2 border-t border-border/50">
                    <p className={`text-sm text-center font-medium ${weeklySessions >= weeklyGoal ? 'text-success' : 'text-muted-foreground'}`}>
                        {getEncouragementMessage()}
                    </p>
                </div>
            </div>
        </Card>
    );
};
