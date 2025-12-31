import React, { useState, useMemo, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';
import { TrendingUp, Clock, Layers, Download, Target, Gauge, BarChart, Settings, Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';
import { ErrorDisplay } from './ErrorDisplay';
import { generateSessionPdf } from '../lib/pdfGenerator';
import { formatDate, formatDateTime } from '../lib/dateUtils';
import { FillerWordTable } from './analytics/FillerWordTable';
import { TopFillerWords } from './analytics/TopFillerWords';
// import { STTAccuracyComparison } from './analytics/STTAccuracyComparison'; // Deferred: STT engine accuracy comparison
import { WeeklyActivityChart } from './analytics/WeeklyActivityChart';
import { GoalsSection } from './analytics/GoalsSection';
import { SessionComparisonDialog } from './analytics/SessionComparisonDialog';
import { TrendChart } from './analytics/TrendChart';

import type { PracticeSession } from '@/types/session';
import type { UserProfile } from '@/types/user';
import type { FillerWordTrends } from '@/types/analytics';
import { EmptyState } from '@/components/ui/EmptyState';
import { TEST_IDS } from '@/constants/testIds';
import { isPro as checkIsPro } from '@/constants/subscriptionTiers';

// --- Prop Interfaces ---

/**
 * AnalyticsDashboard is a PRESENTATIONAL component.
 * 
 * ARCHITECTURE NOTE (Gap Analysis 2025-12-22):
 * This component follows the Container/Presentational pattern:
 * - It receives ALL data via props (no internal data fetching)
 * - AnalyticsPage.tsx is the CONTAINER that fetches data via useAnalytics()
 * - This separation enables easier testing and clear data flow
 * 
 * @see AnalyticsPage.tsx - Container component that fetches and passes data
 */
interface AnalyticsDashboardProps {
    profile: UserProfile | null;
    sessionHistory: PracticeSession[];
    overallStats: OverallStats;
    fillerWordTrends: FillerWordTrends;
    loading: boolean;
    error: Error | null;
    onUpgrade: () => void;
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
    isSelected: boolean;
    onToggleSelect: (sessionId: string) => void;
}

// --- Stat Card Configuration ---
// Exhaustive list of all available stat cards for user customization
// Add new stat cards here for future analytics features

type OverallStats = {
    totalSessions: number;
    totalPracticeTime: number;
    avgWpm: number;
    avgFillerWordsPerMin: string | number;
    avgAccuracy: string | number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chartData: any[];
};

type StatCardConfig = {
    id: string;
    label: string;
    icon: React.ReactNode;
    getValue: (stats: OverallStats) => string | number;
    unit?: string;
    description?: string;
};

const STAT_CARD_OPTIONS: StatCardConfig[] = [
    {
        id: 'total_sessions',
        label: 'Total Sessions',
        icon: <Layers size={24} className="text-muted-foreground" />,
        getValue: (stats) => stats.totalSessions,
        description: 'Number of practice sessions completed'
    },
    {
        id: 'speaking_pace',
        label: 'Speaking Pace',
        icon: <Gauge size={24} className="text-muted-foreground" />,
        getValue: (stats) => stats.avgWpm,
        unit: 'WPM',
        description: 'Average words per minute'
    },
    {
        id: 'filler_words_per_min',
        label: 'Avg. Filler Words / Min',
        icon: <TrendingUp size={24} className="text-muted-foreground" />,
        getValue: (stats) => stats.avgFillerWordsPerMin,
        description: 'Filler word frequency per minute'
    },
    {
        id: 'total_practice_time',
        label: 'Total Practice Time',
        icon: <Clock size={24} className="text-muted-foreground" />,
        getValue: (stats) => stats.totalPracticeTime,
        unit: 'mins',
        description: 'Total time spent practicing'
    },
    {
        id: 'clarity_score',
        label: 'Clarity Score',
        icon: <Target size={24} className="text-muted-foreground" />,
        getValue: (stats) => stats.avgAccuracy,
        unit: '%',
        description: 'Average speech clarity percentage'
    },
    // Future stat cards can be added here
    {
        id: 'avg_session_length',
        label: 'Avg. Session Length',
        icon: <Activity size={24} className="text-muted-foreground" />,
        getValue: (stats) => stats.totalSessions > 0 ? Math.round(stats.totalPracticeTime / stats.totalSessions) : 0,
        unit: 'mins',
        description: 'Average duration per session'
    },
];

// Default cards to show (first 4)
const DEFAULT_SELECTED_CARDS = ['total_sessions', 'speaking_pace', 'filler_words_per_min', 'total_practice_time'];
const STORAGE_KEY = 'speaksharp_selected_stat_cards';

// --- Analysis Slide Configuration ---
// Available analysis visualization tools for the main carousel
// Add new charts/tools here

type AnalysisSlideConfig = {
    id: string;
    label: string;
    description: string;
};

const ANALYSIS_SLIDE_OPTIONS: AnalysisSlideConfig[] = [
    {
        id: 'pace_trend',
        label: 'Speaking Pace Trend',
        description: 'Track your words per minute over time'
    },
    {
        id: 'clarity_trend',
        label: 'Clarity Score Trend',
        description: 'Monitor your speech clarity percentage'
    },
    {
        id: 'weekly_activity',
        label: 'Weekly Activity',
        description: 'Your practice frequency this week'
    },
    {
        id: 'goals_progress',
        label: 'Current Goals',
        description: 'Track progress toward weekly targets'
    },
    {
        id: 'filler_trend',
        label: 'Filler Word Trend',
        description: 'See how your filler word usage is changing'
    },
    {
        id: 'filler_analysis',
        label: 'Detailed Filler Analysis',
        description: 'Breakdown of specific filler words usage'
    },

];

const DEFAULT_ANALYSIS_SLIDES = ['pace_trend', 'clarity_trend', 'goals_progress', 'weekly_activity'];
const ANALYSIS_STORAGE_KEY = 'speaksharp_selected_analysis_slides_v3';

// --- Sub-components ---

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, unit, className, testId }) => (
    <Card className={className} data-testid={testId || `stat-card-${label.toLowerCase().replace(/\s+/g, '-')}`}>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            {icon}
        </CardHeader>
        <CardContent>
            <div className="flex items-baseline gap-1">
                <span style={{ fontSize: '48px', fontWeight: 700, color: '#2aa198', lineHeight: 1 }}>
                    {value}
                </span>
                {unit && <span className="text-xl font-medium text-muted-foreground">{unit}</span>}
            </div>
        </CardContent>
    </Card>
);


interface SessionHistoryItemProps {
    session: PracticeSession;
    isPro: boolean;
    isSelected: boolean;
    onToggleSelect: (sessionId: string) => void;
    profileName: string;
}

const SessionHistoryItem: React.FC<SessionHistoryItemProps> = ({ session, isPro, isSelected, onToggleSelect, profileName }) => {
    const totalFillers = Object.values(session.filler_words || {}).reduce((sum, data) => sum + (data.count || 0), 0);
    const durationMins = (session.duration / 60).toFixed(1);
    const wpm = session.wpm ?? (session.duration > 0 && session.total_words ? Math.round((session.total_words / session.duration) * 60) : 'N/A');
    const clarity = session.clarity_score ?? (session.accuracy ? (session.accuracy * 100) : null);

    return (
        <Card className="p-4 transition-all duration-200 hover:bg-secondary/50" data-testid={`${TEST_IDS.SESSION_HISTORY_ITEM}-${session.id}`}>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-grow">
                    <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onToggleSelect(session.id)}
                        data-testid="compare-checkbox"
                        aria-label={`Select session for comparison`}
                    />
                    <div>
                        <p className="font-semibold text-foreground text-base">{session.title || `Session from ${formatDate(session.created_at)}`}</p>
                        <p className="text-xs text-muted-foreground">
                            {formatDateTime(session.created_at)}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-6 text-right">
                    <div>
                        <p className="text-xs text-muted-foreground">Pace</p>
                        <p className="font-bold text-base text-foreground">{wpm} WPM</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">Accuracy</p>
                        <p className="font-bold text-base text-foreground">{clarity ? `${clarity.toFixed(1)}%` : 'N/A'}</p>
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
                        <div>
                            <p className="text-xs text-muted-foreground">Report</p>
                            <Button variant="ghost" size="icon" className="-mr-2 h-7 w-7" onClick={() => generateSessionPdf(session, profileName)} aria-label="Download Session PDF" title="Download Session PDF">
                                <Download className="h-4 w-4" />
                            </Button>
                        </div>
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

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
    profile,
    sessionHistory,
    overallStats,
    fillerWordTrends,
    loading,
    error,
    onUpgrade
}) => {
    const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
    const [showComparison, setShowComparison] = useState(false);

    // Analysis slide selection state with localStorage persistence
    const [selectedAnalysisSlides, setSelectedAnalysisSlides] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem(ANALYSIS_STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                // Validate that saved slides still exist in options
                const validSlides = parsed.filter((id: string) => ANALYSIS_SLIDE_OPTIONS.some(opt => opt.id === id));
                if (validSlides.length >= 1) {
                    return validSlides;
                }
            }
        } catch (e) {
            console.warn('Failed to load saved analysis slide preferences');
        }
        return DEFAULT_ANALYSIS_SLIDES;
    });

    const isProUser = checkIsPro(profile?.subscription_status);
    const isUpgradeBannerVisible = !isProUser;

    // Stat card selection state with localStorage persistence
    const [selectedStatCards, setSelectedStatCards] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                // Validate that saved cards still exist in options
                const validCards = parsed.filter((id: string) => STAT_CARD_OPTIONS.some(opt => opt.id === id));
                if (validCards.length >= 1 && validCards.length <= 4) {
                    return validCards;
                }
            }
        } catch (e) {
            console.warn('Failed to load saved stat card preferences');
        }
        return DEFAULT_SELECTED_CARDS;
    });

    // Save to localStorage when selection changes
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedStatCards));
        } catch (e) {
            console.warn('Failed to save stat card preferences');
        }
    }, [selectedStatCards]);



    // Carousel API state
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [api, setApi] = useState<any>();
    const [current, setCurrent] = useState(0);
    const [count, setCount] = useState(0);

    useEffect(() => {
        if (!api) {
            return;
        }

        setCount(api.scrollSnapList().length);
        setCurrent(api.selectedScrollSnap() + 1);

        api.on("select", () => {
            setCurrent(api.selectedScrollSnap() + 1);
        });
    }, [api]);

    // Update count when selected items change
    useEffect(() => {
        if (api) {
            setCount(api.scrollSnapList().length);
            setCurrent(api.selectedScrollSnap() + 1);
        }
    }, [selectedAnalysisSlides, api]);

    // Customize Analysis Menu Hover State
    const [isAnalysisMenuOpen, setIsAnalysisMenuOpen] = useState(false);
    const analysisMenuTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const openAnalysisMenu = () => {
        if (analysisMenuTimeoutRef.current) {
            clearTimeout(analysisMenuTimeoutRef.current);
        }
        setIsAnalysisMenuOpen(true);
    };

    const closeAnalysisMenu = () => {
        analysisMenuTimeoutRef.current = setTimeout(() => {
            setIsAnalysisMenuOpen(false);
        }, 200);
    };

    const toggleStatCard = (cardId: string) => {
        setSelectedStatCards(prev => {
            if (prev.includes(cardId)) {
                // Don't allow deselecting if only 1 card remains
                if (prev.length <= 1) return prev;
                return prev.filter(id => id !== cardId);
            } else {
                // Don't allow selecting more than 4
                if (prev.length >= 4) return prev;
                return [...prev, cardId];
            }
        });
    };



    // Save to localStorage when selection changes
    useEffect(() => {
        try {
            localStorage.setItem(ANALYSIS_STORAGE_KEY, JSON.stringify(selectedAnalysisSlides));
        } catch (e) {
            console.warn('Failed to save analysis slide preferences');
        }
    }, [selectedAnalysisSlides]);

    const toggleAnalysisSlide = (slideId: string) => {
        if (selectedAnalysisSlides.includes(slideId)) {
            if (selectedAnalysisSlides.length <= 1) {
                // Optional: Toast for min 1
                return;
            }
            setSelectedAnalysisSlides(prev => prev.filter(id => id !== slideId));
        } else {
            if (selectedAnalysisSlides.length >= 4) {
                toast.error("Max 4 analysis slides. Please deselect one first.");
                return;
            }
            setSelectedAnalysisSlides(prev => [...prev, slideId]);
        }
    };

    const toggleSessionSelection = (sessionId: string) => {
        setSelectedSessions(prev =>
            prev.includes(sessionId)
                ? prev.filter(id => id !== sessionId)
                : prev.length < 2
                    ? [...prev, sessionId]
                    : prev
        );
    };

    const selectedSessionData = useMemo(() => {
        if (selectedSessions.length !== 2 || !sessionHistory) return null;
        const sessions = selectedSessions.map(id => sessionHistory.find(s => s.id === id)).filter(Boolean);
        if (sessions.length !== 2) return null;
        return sessions.map(s => ({
            id: s!.id,
            created_at: s!.created_at,
            wpm: s!.duration > 0 && s!.total_words ? Math.round((s!.total_words / s!.duration) * 60) : 0,
            clarity_score: s!.accuracy ? Math.round(s!.accuracy * 100) : 0,
            filler_count: Object.values(s!.filler_words || {}).reduce((sum, data) => sum + (data.count || 0), 0),
            duration_seconds: s!.duration,
        })) as [{ id: string; created_at: string; wpm: number; clarity_score: number; filler_count: number; duration_seconds: number }, { id: string; created_at: string; wpm: number; clarity_score: number; filler_count: number; duration_seconds: number }];
    }, [selectedSessions, sessionHistory]);

    const trendData = useMemo(() => {
        if (!sessionHistory || sessionHistory.length < 2) return [];
        return sessionHistory.slice(0, 10).reverse().map(s => ({
            date: formatDate(s.created_at),
            wpm: s.duration > 0 && s.total_words ? Math.round((s.total_words / s.duration) * 60) : 0,
            clarity: s.accuracy ? Math.round(s.accuracy * 100) : 0,
            fillers: Object.values(s.filler_words || {}).reduce((sum, data) => sum + (data.count || 0), 0),
        }));
    }, [sessionHistory]);

    console.log('[AnalyticsDashboard] Rendering. Loading:', loading, 'Error:', error, 'SessionHistory length:', sessionHistory?.length);

    if (loading) {
        console.log('[AnalyticsDashboard] Showing skeleton (loading)');
        return <AnalyticsDashboardSkeleton />;
    }
    if (error) {
        console.log('[AnalyticsDashboard] Showing error display:', error);
        return <ErrorDisplay error={error} />;
    }
    if (!sessionHistory || sessionHistory.length === 0) {
        console.log('[AnalyticsDashboard] Showing empty state (no sessions)');
        return (
            <EmptyState
                title="Your Dashboard Awaits!"
                description="Record your next session to unlock your progress trends and full analytics!"
                action={{
                    label: "Get Started",
                    href: "/session"
                }}
                icon={<BarChart className="w-10 h-10 text-primary" />}
                testId="analytics-dashboard-empty-state"
                // Subtle upgrade option for FREE users - triggers Stripe checkout directly
                secondaryAction={!isProUser ? {
                    prefix: "Want unlimited sessions?",
                    label: "Upgrade to Pro",
                    onClick: onUpgrade,
                    testId: "analytics-dashboard-upgrade-button"
                } : undefined}
            />
        );
    }
    // --- Image Example (Commented out: Requires browser-compatible handling) ---
    /*
    try {
      // const imageBuffer = ...
      // await processImage(imageBuffer, 200, 200);
    } catch (error) {
      console.error('Error processing image:', error);
    }
    */
    console.log('[AnalyticsDashboard] Showing full dashboard with', sessionHistory.length, 'sessions');


    return (
        <div className="space-y-8" data-testid={TEST_IDS.ANALYTICS_DASHBOARD}>
            {/* Upgrade Banner for Free Users */}
            {isUpgradeBannerVisible && (
                <Card className="bg-gradient-to-r from-primary/10 to-secondary/10 border-primary/20" data-testid="analytics-dashboard-upgrade-button">
                    <CardContent className="flex flex-col sm:flex-row items-center justify-between p-6 gap-4">
                        <div className="space-y-1 text-center sm:text-left">
                            <h3 className="font-semibold text-lg text-foreground">Upgrade to Pro</h3>
                            <p className="text-sm text-muted-foreground max-w-md">
                                Unlock unlimited sessions coverage, advanced PDF reports, and detailed filler word analysis.
                            </p>
                        </div>
                        <Button onClick={onUpgrade} className="w-full sm:w-auto gap-2 shadow-lg">
                            <span className="font-bold">Upgrade Now</span>
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* Stats Section Header with Settings */}
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Overview</h2>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="gap-2 hover:bg-secondary hover:text-gray-900">
                            <Settings className="h-4 w-4" />
                            <span className="hidden sm:inline">Customize Stats</span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel>Display Stats ({selectedStatCards.length}/4)</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {STAT_CARD_OPTIONS.map(option => (
                            <DropdownMenuCheckboxItem
                                key={option.id}
                                checked={selectedStatCards.includes(option.id)}
                                onCheckedChange={() => toggleStatCard(option.id)}
                                disabled={
                                    (!selectedStatCards.includes(option.id) && selectedStatCards.length >= 4) ||
                                    (selectedStatCards.includes(option.id) && selectedStatCards.length <= 1)
                                }
                            >
                                {option.label}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Dynamic Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {STAT_CARD_OPTIONS
                    .filter(option => selectedStatCards.includes(option.id))
                    .map(option => (
                        <StatCard
                            key={option.id}
                            icon={option.icon}
                            label={option.label}
                            value={option.getValue(overallStats)}
                            unit={option.unit}
                            testId={`stat-card-${option.id}`}
                        />
                    ))
                }
            </div>

            {/* Analysis Section Header with Settings */}
            <div className="flex items-center justify-between pt-4">
                <div className="space-y-1">
                    <h2 className="text-xl font-semibold text-foreground">Speech Pattern Analysis</h2>
                    <p className="text-sm text-muted-foreground">Deep dive into your speaking performance</p>
                </div>
                <DropdownMenu open={isAnalysisMenuOpen} onOpenChange={setIsAnalysisMenuOpen}>
                    <DropdownMenuTrigger asChild onMouseEnter={openAnalysisMenu} onMouseLeave={closeAnalysisMenu}>
                        <Button variant="ghost" size="sm" className="gap-2 hover:bg-secondary hover:text-gray-900">
                            <Settings className="h-4 w-4" />
                            <span className="hidden sm:inline">Customize Analysis</span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56" onMouseEnter={openAnalysisMenu} onMouseLeave={closeAnalysisMenu}>
                        <DropdownMenuLabel>Display Analysis ({selectedAnalysisSlides.length}/4)</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {ANALYSIS_SLIDE_OPTIONS.map(option => (
                            <DropdownMenuCheckboxItem
                                key={option.id}
                                checked={selectedAnalysisSlides.includes(option.id)}
                                onCheckedChange={() => toggleAnalysisSlide(option.id)}
                                disabled={
                                    selectedAnalysisSlides.includes(option.id) && selectedAnalysisSlides.length <= 1
                                }
                            >
                                {option.label}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Analysis Carousel */}
            <div className="space-y-4">
                <Carousel className="w-full" opts={{ loop: true }} setApi={setApi}>
                    <CarouselContent>
                        {ANALYSIS_SLIDE_OPTIONS
                            .filter(option => selectedAnalysisSlides.includes(option.id))
                            .map(option => (
                                <CarouselItem key={option.id} className="basis-full">
                                    <div className="p-1">
                                        {/* Render content based on ID */}
                                        {option.id === 'pace_trend' && (
                                            <div>
                                                <TrendChart
                                                    title="Speaking Pace Trend"
                                                    description="Track your words per minute over time"
                                                    data={trendData}
                                                    metric="wpm"
                                                />
                                            </div>
                                        )}
                                        {option.id === 'clarity_trend' && (
                                            <div>
                                                <TrendChart
                                                    title="Clarity Trend"
                                                    description="Monitor your speech clarity percentage"
                                                    data={trendData}
                                                    metric="clarity"
                                                />
                                            </div>
                                        )}
                                        {option.id === 'weekly_activity' && (
                                            <WeeklyActivityChart />
                                        )}
                                        {option.id === 'goals_progress' && (
                                            <GoalsSection />
                                        )}
                                        {option.id === 'filler_trend' && (
                                            <Card>
                                                <CardHeader><CardTitle>Filler Word Trend</CardTitle></CardHeader>
                                                <CardContent className="pl-2">
                                                    {overallStats.chartData.length > 1 ? (
                                                        <div className="h-[300px] w-full">
                                                            <ResponsiveContainer width="100%" height="100%">
                                                                <LineChart data={overallStats.chartData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                                                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                                                                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize="0.875rem" tickLine={false} axisLine={false} />
                                                                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize="0.875rem" tickLine={false} axisLine={false} />
                                                                    <Tooltip cursor={{ fill: 'hsla(var(--secondary))' }} contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
                                                                    <Line type="monotone" dataKey="FW/min" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                                                                </LineChart>
                                                            </ResponsiveContainer>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center justify-center h-[300px] text-center text-muted-foreground"><p>Complete at least two sessions to see your progress trend.</p></div>
                                                    )}
                                                </CardContent>
                                            </Card>
                                        )}
                                        {option.id === 'filler_analysis' && (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <TopFillerWords />
                                                <FillerWordTable trendData={fillerWordTrends} />
                                            </div>
                                        )}

                                    </div>
                                </CarouselItem>
                            ))
                        }
                    </CarouselContent>
                    <CarouselPrevious />
                    <CarouselNext />
                </Carousel>
                {/* Carousel Indicators */}
                <div className="flex justify-center gap-2 py-2">
                    {Array.from({ length: count }).map((_, index) => (
                        <button
                            key={index}
                            className={`h-2 rounded-full transition-all duration-300 ${index + 1 === current ? 'w-8 bg-secondary' : 'w-2 bg-muted-foreground/30'}`}
                            onClick={() => api?.scrollTo(index)}
                            aria-label={`Go to slide ${index + 1}`}
                        />
                    ))}
                </div>

                {/* Session History Section - Moved below carousel */}
                <div id="session-history-section">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle>Session History</CardTitle>
                            {selectedSessions.length === 2 && (
                                <Button
                                    onClick={() => setShowComparison(true)}
                                    variant="default"
                                >
                                    Compare Sessions
                                </Button>
                            )}
                        </CardHeader>
                        <CardContent className="space-y-4" data-testid={TEST_IDS.SESSION_HISTORY_LIST}>
                            {sessionHistory && sessionHistory.length > 0 ? (
                                sessionHistory.slice(0, 10).map((session) => (
                                    <SessionHistoryItem
                                        key={session.id}
                                        session={session}
                                        isPro={isProUser}
                                        isSelected={selectedSessions.includes(session.id)}
                                        onToggleSelect={toggleSessionSelection}
                                        profileName={''}
                                    />
                                ))
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">No sessions available.</div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

            {
                selectedSessionData && (
                    <SessionComparisonDialog
                        open={showComparison}
                        onOpenChange={setShowComparison}
                        sessions={selectedSessionData}
                    />
                )
            }
        </div >
    );
};
