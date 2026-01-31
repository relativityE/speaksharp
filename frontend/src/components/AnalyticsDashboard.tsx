import React, { useState, useMemo, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';
import { TrendingUp, Clock, Layers, Download, Target, Gauge, BarChart, Settings, Activity, Mic } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from '@/components/ui/carousel';
import { ErrorDisplay } from './ErrorDisplay';
import { generateSessionPdf } from '../lib/pdfGenerator';
import { formatDate, formatDateTime } from '../lib/dateUtils';
import { FillerWordTable } from './analytics/FillerWordTable';
import { TopFillerWords } from './analytics/TopFillerWords';
import { STTAccuracyComparison } from './analytics/STTAccuracyComparison';
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
    profileName: string;
}

// --- Stat Card Configuration ---
// Exhaustive list of all available stat cards for user customization
// Add new stat cards here for future analytics features

type ChartDataPoint = {
    date: string;
    'FW/min': string | number;
    [key: string]: string | number;
};

type OverallStats = {
    totalSessions: number;
    totalPracticeTime: number;
    avgWpm: number;
    avgFillerWordsPerMin: string | number;
    avgAccuracy: string | number;
    chartData: ChartDataPoint[];
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
    {
        id: 'stt_comparison',
        label: 'STT Accuracy Comparison',
        description: 'Compare transcription engine performance'
    },

];

const DEFAULT_ANALYSIS_SLIDES = ['pace_trend', 'clarity_trend', 'goals_progress', 'weekly_activity'];
const ANALYSIS_STORAGE_KEY = 'speaksharp_selected_analysis_slides_v3';

// --- Sub-components ---

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, unit, className, testId }) => (
    <Card className={`bg-card border-border p-6 rounded-xl shadow-sm ${className}`} data-testid={testId || `stat-card-${label.toLowerCase().replace(/\s+/g, '-')}`}>
        <div className="flex items-center justify-between mb-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${label.includes('Filler') ? 'bg-secondary/10 text-secondary' : 'bg-primary/10 text-primary'}`}>
                {/* Clone icon to enforce size and styling if needed, but usually props are fine. Wrapper handles color. */}
                {React.cloneElement(icon as React.ReactElement, { size: 24, className: "stroke-current" })}
            </div>
            {/* Trend placeholder - could be passed as prop later */}
            {label.includes('Pace') && (
                <span className="flex items-center gap-1 text-sm text-emerald-500 font-medium">
                    <TrendingUp className="w-4 h-4" />
                    Target: 130-150
                </span>
            )}
        </div>
        <div>
            <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-foreground tracking-tight">
                    {value}
                </span>
                {unit && <span className="text-sm font-medium text-muted-foreground ml-1">{unit}</span>}
            </div>
            <p className="text-sm text-muted-foreground mt-1 font-medium">{label}</p>
        </div>
    </Card>
);

const SessionHistoryItem: React.FC<SessionHistoryItemProps> = ({ session, isPro, isSelected, onToggleSelect, profileName }) => {
    const totalFillers = Object.values(session.filler_words || {}).reduce((sum, data) => sum + (data.count || 0), 0);
    const durationMins = Math.floor(session.duration / 60);
    const durationSecs = session.duration % 60;
    const durationStr = `${durationMins}:${durationSecs.toString().padStart(2, '0')}`;

    const wpm = session.wpm ?? (session.duration > 0 && session.total_words ? Math.round((session.total_words / session.duration) * 60) : 0);
    const clarity = session.clarity_score ?? (session.accuracy ? (session.accuracy * 100) : 0);

    return (
        <div
            className="group flex flex-col md:flex-row items-center justify-between p-4 bg-muted/30 rounded-xl hover:bg-muted/50 transition-all border border-transparent hover:border-border mb-3 last:mb-0"
            data-testid={`${TEST_IDS.SESSION_HISTORY_ITEM}-${session.id}`}
        >
            <div className="flex items-center gap-4 w-full md:w-auto mb-4 md:mb-0">
                <div className="flex items-center h-full">
                    <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onToggleSelect(session.id)}
                        className="mr-4"
                        aria-label={`Select session for comparison`}
                    />
                </div>
                <div className="w-12 h-12 bg-secondary/20 rounded-xl flex items-center justify-center shrink-0">
                    <Mic className="w-6 h-6 text-secondary" />
                </div>
                <div>
                    <p className="font-semibold text-foreground text-base truncate max-w-[200px]">{session.title || 'Practice Session'}</p>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <span>{durationStr} duration</span>
                        <span className="text-muted-foreground/50">•</span>
                        <span>{formatDateTime(session.created_at)}</span>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-8 w-full md:w-auto justify-between md:justify-end px-4 md:px-0">
                <div className="text-center">
                    <p className="font-bold text-foreground text-lg">{wpm}</p>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">WPM</p>
                </div>
                <div className="text-center">
                    <p className={`font-bold text-lg ${totalFillers <= 3 ? "text-emerald-500" : "text-secondary"}`}>
                        {totalFillers}
                    </p>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Fillers</p>
                </div>
                <div className="text-center">
                    <p className="font-bold text-primary text-lg">{typeof clarity === 'number' ? clarity.toFixed(0) : '0'}%</p>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Clarity</p>
                </div>

                {isPro && (
                    <div className="pl-4 border-l border-border hidden md:block">
                        <Button
                            variant="secondary"
                            size="sm"
                            className="gap-2 hover:bg-primary hover:text-primary-foreground transition-all shadow-sm"
                            onClick={() => generateSessionPdf(session, profileName)}
                            title="Download Session PDF"
                            data-testid={`download-pdf-btn-${session.id}`}
                        >
                            <Download className="h-4 w-4" />
                            PDF
                        </Button>
                    </div>
                )}
            </div>
            {isPro && (
                <div className="w-full flex justify-end md:hidden pt-4 border-t border-border mt-4">
                    <Button variant="secondary" size="sm" className="w-full gap-2 text-muted-foreground" onClick={() => generateSessionPdf(session, profileName)} data-testid={`download-pdf-btn-mobile-${session.id}`}>
                        <Download className="h-4 w-4" /> Download Session PDF
                    </Button>
                </div>
            )}
        </div>
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
    const [api, setApi] = useState<CarouselApi>();
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

    return (
        <div className="space-y-8" data-testid={TEST_IDS.ANALYTICS_DASHBOARD}>
            {loading ? (
                <AnalyticsDashboardSkeleton />
            ) : error ? (
                <ErrorDisplay error={error} />
            ) : !sessionHistory || sessionHistory.length === 0 ? (
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
            ) : (
                <>
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
                                                {option.id === 'stt_comparison' && (
                                                    <STTAccuracyComparison />
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
                            <Card className="bg-card border-border p-6 rounded-2xl shadow-sm">
                                <div className="flex items-center justify-between mb-6">
                                    <div>
                                        <h2 className="text-xl font-bold text-foreground">Export Reports</h2>
                                        <p className="text-sm text-muted-foreground mt-1">Download detailed session summaries and performance analysis</p>
                                    </div>
                                    {selectedSessions.length === 2 && (
                                        <Button
                                            onClick={() => setShowComparison(true)}
                                            className="bg-primary text-primary-foreground hover:bg-primary/90"
                                        >
                                            Compare Selected (2)
                                        </Button>
                                    )}
                                </div>
                                <div className="space-y-4" data-testid={TEST_IDS.SESSION_HISTORY_LIST}>
                                    {sessionHistory && sessionHistory.length > 0 ? (
                                        sessionHistory.slice(0, 10).map((session) => (
                                            <SessionHistoryItem
                                                key={session.id}
                                                session={session}
                                                isPro={isProUser}
                                                isSelected={selectedSessions.includes(session.id)}
                                                onToggleSelect={toggleSessionSelection}
                                                profileName={profile?.email || 'User'}
                                            />
                                        ))
                                    ) : (
                                        <div className="text-center py-12 text-muted-foreground bg-muted/20 rounded-xl border border-dashed border-border">
                                            <p>No sessions recorded yet.</p>
                                        </div>
                                    )}
                                </div>
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
                </>
            )}
        </div>
    );
};
