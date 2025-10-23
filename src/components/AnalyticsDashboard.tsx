import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Clock, Layers, Sparkles, Download, Target, Gauge } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorDisplay } from './ErrorDisplay';
import { generateSessionPdf } from '../lib/pdfGenerator';
import { calculateOverallStats, calculateFillerWordTrends } from '../lib/analyticsUtils';
import { formatDate, formatDateTime } from '../lib/dateUtils';
import { FillerWordTable } from './analytics/FillerWordTable';
import { TopFillerWords } from './analytics/TopFillerWords';
import { AccuracyComparison } from './analytics/AccuracyComparison';
import { supabase } from '@/lib/supabaseClient';
import logger from '../lib/logger';
import type { PracticeSession } from '@/types/session';
import type { UserProfile } from '@/types/user';

// --- Prop Interfaces ---

interface AnalyticsDashboardProps {
  sessionHistory: PracticeSession[];
  profile: UserProfile | null;
  loading: boolean;
  error: Error | null;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  className?: string;
  testId?: string;
}

interface SessionHistoryItemProps {
  session: PracticeSession;
  isPro: boolean;
}

// --- Sub-components ---

const EmptyState: React.FC = () => {
    const navigate = useNavigate();
    return (
        <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed" data-testid="analytics-dashboard-empty-state">
            <Sparkles className="w-12 h-12 text-yellow-400 mb-4" />
            <h2 className="text-xl font-bold text-foreground">Your Dashboard Awaits!</h2>
            <p className="max-w-md mx-auto my-4 text-base text-muted-foreground">
                Record your next session to unlock your progress trends and full analytics!
            </p>
            <Button onClick={() => navigate('/session')} size="lg">
                Start a New Session →
            </Button>
        </Card>
    );
};

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, unit, className, testId }) => (
    <Card className={className} data-testid={testId || `stat-card-${label.toLowerCase().replace(/\s+/g, '-')}`}>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            {icon}
        </CardHeader>
        <CardContent>
            <div className="text-4xl font-bold text-foreground">
                {value}
                {unit && <span className="ml-2 text-xl font-normal text-muted-foreground">{unit}</span>}
            </div>
        </CardContent>
    </Card>
);

const SessionHistoryItem: React.FC<SessionHistoryItemProps> = ({ session, isPro }) => {
    const totalFillers = Object.values(session.filler_words || {}).reduce((sum, data) => sum + (data.count || 0), 0);
    const durationMins = (session.duration / 60).toFixed(1);
    const wpm = session.duration > 0 && session.total_words ? ((session.total_words / session.duration) * 60).toFixed(0) : 'N/A';

    return (
        <Card className="p-4 transition-all duration-200 hover:bg-secondary/50" data-testid="session-history-item">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex-grow">
                    <p className="font-semibold text-foreground text-base">{session.title || `Session from ${formatDate(session.created_at)}`}</p>
                    <p className="text-xs text-muted-foreground">
                        {formatDateTime(session.created_at)}
                    </p>
                </div>
                <div className="flex items-center gap-6 text-right">
                    <div>
                        <p className="text-xs text-muted-foreground">Pace</p>
                        <p className="font-bold text-base text-foreground">{wpm} WPM</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">Accuracy</p>
                        <p className="font-bold text-base text-foreground">{session.accuracy ? `${(session.accuracy * 100).toFixed(1)}%` : 'N/A'}</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">Fillers</p>
                        <p className="font-bold text-base text-foreground">{totalFillers}</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">Duration</p>
                        <p className="font-bold text-base text-foreground">{durationMins} min</p>
                    </div>
                    {isPro && (
                        <Button variant="outline" size="icon" onClick={() => generateSessionPdf(session)} aria-label="Download Session PDF">
                            <Download className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            </div>
        </Card>
    );
};

export const AnalyticsDashboardSkeleton: React.FC = () => (
    <div className="space-y-8 animate-pulse" data-testid="analytics-dashboard-skeleton">
        <div className="grid gap-6 md:grid-cols-3">
            <Card><CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0"><Skeleton className="h-5 w-2/5" /></CardHeader><CardContent><Skeleton className="h-8 w-1/3" /></CardContent></Card>
            <Card><CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0"><Skeleton className="h-5 w-4/5" /></CardHeader><CardContent><Skeleton className="h-8 w-1/3" /></CardContent></Card>
            <Card><CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0"><Skeleton className="h-5 w-3/5" /></CardHeader><CardContent><Skeleton className="h-8 w-1/3" /></CardContent></Card>
        </div>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
            <Card className="col-span-1 lg:col-span-3"><CardHeader><Skeleton className="h-6 w-1/3" /></CardHeader><CardContent><Skeleton className="h-[240px] w-full" /></CardContent></Card>
            <Card className="col-span-1 lg:col-span-2"><CardHeader><Skeleton className="h-6 w-1/2" /></CardHeader><CardContent><Skeleton className="h-[240px] w-full" /></CardContent></Card>
        </div>
        <Card><CardHeader><Skeleton className="h-6 w-1/4" /></CardHeader><CardContent className="space-y-4"><div className="flex justify-between items-center"><div className="space-y-2"><Skeleton className="h-5 w-48" /><Skeleton className="h-4 w-32" /></div><div className="space-y-2 text-right"><Skeleton className="h-5 w-24" /><Skeleton className="h-4 w-20" /></div></div><div className="flex justify-between items-center"><div className="space-y-2"><Skeleton className="h-5 w-48" /><Skeleton className="h-4 w-32" /></div><div className="space-y-2 text-right"><Skeleton className="h-5 w-24" /><Skeleton className="h-4 w-20" /></div></div></CardContent></Card>
    </div>
);

// --- Main Component ---

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ sessionHistory, profile, loading, error }) => {
    if (loading) return <AnalyticsDashboardSkeleton />;
    if (error) return <ErrorDisplay error={error} />;
    if (!sessionHistory || sessionHistory.length === 0) return <EmptyState />;

    const overallStats = calculateOverallStats(sessionHistory);
    const fillerWordTrends = calculateFillerWordTrends(sessionHistory.slice(0, 5));
    const isPro = profile?.subscription_status === 'pro';

    const handleUpgrade = async () => {
        try {
            const { data, error } = await supabase.functions.invoke('stripe-checkout');
            if (error) throw error;
            if (data.checkoutUrl) window.location.href = data.checkoutUrl;
        } catch (err: unknown) {
            logger.error({ err }, 'Error creating Stripe checkout session:');
        }
    };

    return (
        <div className="space-y-8">
            {!isPro && (
                <Card className="bg-gradient-to-r from-primary/80 to-primary text-primary-foreground p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-4"><Sparkles className="h-8 w-8" /><div><h3 className="font-bold text-lg">Unlock Your Full Potential</h3><p className="text-sm opacity-90">Upgrade to Pro to get unlimited practice time, PDF exports, and more detailed analytics.</p></div></div>
                    <Button variant="secondary" className="w-full sm:w-auto flex-shrink-0 bg-white text-primary hover:bg-gray-200" onClick={handleUpgrade} data-testid="analytics-dashboard-upgrade-button">Upgrade Now</Button>
                </Card>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard icon={<Layers size={24} className="text-muted-foreground" />} label="Total Sessions" value={overallStats.totalSessions} />
                <StatCard icon={<Gauge size={24} className="text-muted-foreground" />} label="Speaking Pace" value={overallStats.avgWpm} unit="WPM" testId="speaking-pace" />
                <StatCard icon={<TrendingUp size={24} className="text-muted-foreground" />} label="Avg. Filler Words / Min" value={overallStats.avgFillerWordsPerMin} testId="avg-filler-words-min" />
                <StatCard icon={<Clock size={24} className="text-muted-foreground" />} label="Total Practice Time" value={overallStats.totalPracticeTime} unit="mins" testId="total-practice-time" />
                <StatCard icon={<Target size={24} className="text-muted-foreground" />} label="Avg. Accuracy" value={overallStats.avgAccuracy} unit="%" testId="avg-accuracy" />
            </div>
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
                <div className="col-span-1 lg:col-span-5">
                    <AccuracyComparison />
                </div>
                <Card className="col-span-1 lg:col-span-3">
                    <CardHeader><CardTitle>Filler Word Trend</CardTitle></CardHeader>
                    <CardContent className="pl-2">
                        {overallStats.chartData.length > 1 ? (
                            <ResponsiveContainer width="100%" height={300}>
                                <LineChart data={overallStats.chartData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize="0.875rem" tickLine={false} axisLine={false} />
                                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize="0.875rem" tickLine={false} axisLine={false} />
                                    <Tooltip cursor={{ fill: 'hsla(var(--secondary))' }} contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}/>
                                    <Line type="monotone" dataKey="FW/min" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="flex items-center justify-center h-[300px] text-center text-muted-foreground"><p>Complete at least two sessions to see your progress trend.</p></div>
                        )}
                    </CardContent>
                </Card>
                <div className="col-span-1 lg:col-span-2 space-y-8">
                    <TopFillerWords />
                    <FillerWordTable trendData={fillerWordTrends} />
                </div>
            </div>
            <Card>
                <CardHeader><CardTitle>Session History</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                {sessionHistory.slice(0, 10).map((session) => (
                    <SessionHistoryItem key={session.id} session={session} isPro={isPro} />
                    ))}
                </CardContent>
            </Card>
        </div>
    );
};
