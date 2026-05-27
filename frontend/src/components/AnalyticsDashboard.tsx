import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { toast } from '@/lib/toast';
import { TrendingUp, Clock, Layers, Download, Target, Gauge, BarChart, Settings, Activity, Mic, Cloud, Lock, Monitor, Eye } from 'lucide-react';
import logger from '../lib/logger';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from '@/components/ui/carousel';
import { ErrorDisplay } from './ErrorDisplay';
import AISuggestions from './session/AISuggestions';
import { generateSessionPdf } from '../lib/pdfGenerator';
import { formatDate, formatDateTime } from '../lib/dateUtils';
import { FillerWordTable } from './analytics/FillerWordTable';
import { TopFillerWords } from './analytics/TopFillerWords';
import { STTAccuracyVsBenchmark } from './analytics/STTAccuracyVsBenchmark';
import { WeeklyActivityChart } from './analytics/WeeklyActivityChart';
import { GoalsSection } from './analytics/GoalsSection';
import { SessionComparisonDialog } from './analytics/SessionComparisonDialog';
import { TrendChart } from './analytics/TrendChart';
import { useChartContainerReady } from './analytics/useChartContainerReady';
import { formatSessionRecordingMode } from '@/utils/engineLabels';
import { ANALYTICS_THRESHOLDS, getSessionAnalysisMetrics } from '@/utils/sessionAnalysis';

import type { PracticeSession } from '@/types/session';
import type { UserProfile } from '@/types/user';
import type { FillerWordTrends, OverallStats } from '@/types/analytics';
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
    isProUser?: boolean;
    sessionHistory: PracticeSession[];
    overallStats: OverallStats;
    fillerWordTrends: FillerWordTrends;
    loading: boolean;
    error: Error | null;
    onUpgrade: () => void;
    onUpdateGroundTruth?: (sessionId: string, groundTruth: string) => Promise<void>;
    sessionId?: string;
}

interface StatCardProps {
    icon: React.ReactNode;
    label: string;
    value: string | number;
    unit?: string;
    description?: string;
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

interface FillerWordsTrendChartProps {
    data: OverallStats['chartData'];
}

const FillerWordsTrendChart: React.FC<FillerWordsTrendChartProps> = ({ data }) => {
    const chartContainer = useChartContainerReady();

    return (
        <div ref={chartContainer.ref} className="h-[260px] w-full">
            {chartContainer.isReady ? (
                <LineChart width={chartContainer.size.width} height={chartContainer.size.height} data={data} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                        <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize="0.875rem" tickLine={false} axisLine={false} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize="0.875rem" tickLine={false} axisLine={false} />
                        <Tooltip cursor={{ fill: 'hsla(var(--secondary))' }} contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
                        <Line type="monotone" dataKey="FW/min" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                </LineChart>
            ) : (
                <div className="h-full w-full rounded-xl bg-muted/60" aria-hidden="true" />
            )}
        </div>
    );
};

// --- Stat Card Configuration ---
// Exhaustive list of all available stat cards for user customization
// Add new stat cards here for future analytics features


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
        getValue: (stats) => stats.averageWPM,
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
        getValue: (stats) => stats.averageSessionLength,
        unit: 'mins',
        description: 'Average duration per session'
    },
];

// Default cards to show (first 4)
const DEFAULT_SELECTED_CARDS = ['total_sessions', 'speaking_pace', 'filler_words_per_min', 'total_practice_time'];
const STORAGE_KEY = 'speaksharp_selected_stat_cards';

const getEngineBadge = (session: PracticeSession): { label: string; className: string; icon: React.ElementType } => {
    const engine = (session.engine || '').toLowerCase();

    if (engine.includes('cloud') || engine.includes('assembly')) {
        return {
            label: 'Cloud',
            className: 'border-teal-200 bg-teal-50 text-teal-800',
            icon: Cloud,
        };
    }

    if (engine.includes('private') || engine.includes('whisper') || engine.includes('transformers')) {
        return {
            label: 'Private',
            className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
            icon: Lock,
        };
    }

    if (engine.includes('native') || engine.includes('browser')) {
        return {
            label: 'Native Browser',
            className: 'border-[hsl(var(--border-strong))] bg-muted/60 text-foreground',
            icon: Monitor,
        };
    }

    return {
        label: 'Engine unknown',
        className: 'border-[hsl(var(--border-strong))] bg-muted/60 text-foreground',
        icon: Mic,
    };
};

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
        id: 'filler_words',
        label: 'Filler Words',
        description: 'Trend and breakdown of filler word usage'
    },
    {
        id: 'stt_comparison',
        label: 'STT Engine Quality',
        description: 'Compare saved session quality by transcription engine'
    },

];

const LEGACY_ANALYSIS_SLIDE_IDS: Record<string, string> = {
    filler_trend: 'filler_words',
    filler_analysis: 'filler_words',
};

const DEFAULT_ANALYSIS_SLIDES = ['pace_trend', 'clarity_trend', 'weekly_activity', 'filler_words'];
const ANALYSIS_STORAGE_KEY = 'speaksharp_selected_analysis_slides_v6';

// --- Sub-components ---

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, unit, description, className = '', testId }) => (
    <Card className={`rounded-xl p-6 ${className}`} data-testid={testId || `stat-card-${label.toLowerCase().replace(/\s+/g, '-')}`}>
        <div className="flex items-center justify-between mb-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${label.includes('Filler') ? 'bg-accent/10 text-accent' : 'bg-primary/10 text-primary'}`}>
                {/* Clone icon to enforce size and styling if needed, but usually props are fine. Wrapper handles color. */}
                {React.cloneElement(icon as React.ReactElement, { size: 24, className: "stroke-current" })}
            </div>
            {/* Trend placeholder - could be passed as prop later */}
            {label.includes('Pace') && (
                <span className="flex items-center gap-1 text-sm text-success font-medium">
                    <TrendingUp className="w-4 h-4" />
                    Target: {ANALYTICS_THRESHOLDS.TARGET_WPM_MIN}-{ANALYTICS_THRESHOLDS.TARGET_WPM_MAX}
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
            {description && (
                <p className="mt-3 text-xs leading-snug text-muted-foreground" data-testid={`${testId || `stat-card-${label.toLowerCase().replace(/\s+/g, '-')}`}-explanation`}>
                    {description}
                </p>
            )}
        </div>
    </Card>
);

const normalizeAnalysisSlideIds = (ids: string[]): string[] => {
    const validIds = new Set(ANALYSIS_SLIDE_OPTIONS.map(option => option.id));
    const normalized: string[] = [];

    ids.forEach((id) => {
        const nextId = LEGACY_ANALYSIS_SLIDE_IDS[id] ?? id;
        if (!validIds.has(nextId) || normalized.includes(nextId)) return;
        normalized.push(nextId);
    });

    return normalized;
};

const SessionHistoryItem: React.FC<SessionHistoryItemProps> = ({ session, isPro: _isPro, isSelected, onToggleSelect, profileName }) => {
    const metrics = getSessionAnalysisMetrics(session);
    const totalFillers = metrics.fillerCount;
    const durationMins = Math.floor(session.duration / 60);
    const durationSecs = session.duration % 60;
    const durationStr = `${durationMins}:${durationSecs.toString().padStart(2, '0')}`;
    const engineBadge = getEngineBadge(session);
    const EngineIcon = engineBadge.icon;

    const wpm = metrics.wpm;
    const clarity = metrics.clarityScore;

    return (
        <div
            className="group flex flex-col md:flex-row items-center justify-between p-4 bg-muted rounded-xl hover:bg-white transition-colors border border-[hsl(var(--border))] hover:border-[hsl(var(--border-strong))] shadow-card mb-3 last:mb-0"
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
                <NavLink
                    to={`/analytics/${session.id}`}
                    data-testid={`session-detail-link-${session.id}`}
                    className="flex min-w-0 items-center gap-4 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    <div className="w-12 h-12 bg-secondary/20 rounded-xl flex items-center justify-center shrink-0">
                        <Mic className="w-6 h-6 text-secondary" />
                    </div>
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-foreground text-base truncate max-w-[200px]">{session.title || 'Practice Session'}</p>
                            <span
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] ${engineBadge.className}`}
                                data-testid={`session-engine-badge-${session.id}`}
                                title={`Recorded with ${formatSessionRecordingMode(session)}`}
                            >
                                <EngineIcon className="h-3 w-3" aria-hidden="true" />
                                {engineBadge.label}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            <span>{durationStr} duration</span>
                            <span className="text-muted-foreground">•</span>
                            <span>{formatDateTime(session.created_at)}</span>
                        </div>
                    </div>
                </NavLink>
            </div>

            <div className="flex items-center gap-8 w-full md:w-auto justify-between md:justify-end px-4 md:px-0">
                <div className="text-center">
                    <p className="font-bold text-foreground text-lg">{wpm}</p>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">WPM</p>
                </div>
                <div className="text-center">
                    <p className={`font-bold text-lg ${totalFillers <= 3 ? "text-success" : "text-primary"}`}>
                        {totalFillers}
                    </p>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Fillers</p>
                </div>
                <div className="text-center">
                    <p className="font-bold text-primary text-lg">{typeof clarity === 'number' ? clarity.toFixed(0) : '0'}%</p>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Clarity</p>
                </div>

                <div className="pl-4 border-l border-border hidden md:block" data-testid={`download-pdf-container-${session.id}`}>
                    <NavLink
                        to={`/analytics/${session.id}`}
                        className="mb-2 inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[hsl(var(--border-strong))] bg-white px-3 text-sm font-semibold text-foreground shadow-card transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label="Open saved session details"
                        data-testid={`open-session-detail-${session.id}`}
                    >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                        Open
                    </NavLink>
                    <Button
                        variant="secondary"
                        size="sm"
                        className="gap-2 hover:bg-primary hover:text-primary-foreground transition-colors shadow-card"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void generateSessionPdf(session, profileName);
                            }}
                        title="Download Session PDF"
                        data-testid={`download-pdf-btn-${session.id}`}
                    >
                        <Download className="h-4 w-4" />
                        PDF
                    </Button>
                </div>
            </div>
            <div className="w-full flex justify-end md:hidden pt-4 border-t border-border mt-4" data-testid={`download-pdf-container-mobile-${session.id}`}>
                <div className="flex w-full flex-col gap-2">
                    <NavLink
                        to={`/analytics/${session.id}`}
                        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-[hsl(var(--border-strong))] bg-white px-3 text-sm font-semibold text-foreground shadow-card transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label="Open saved session details"
                        data-testid={`open-session-detail-mobile-${session.id}`}
                    >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                        Open Saved Session
                    </NavLink>
                    <Button
                        variant="secondary"
                        size="sm"
                        className="w-full gap-2 text-muted-foreground"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void generateSessionPdf(session, profileName);
                        }}
                        data-testid={`download-pdf-btn-mobile-${session.id}`}
                    >
                        <Download className="h-4 w-4" /> Download Session PDF
                    </Button>
                </div>
            </div>
        </div>
    );
};

export const AnalyticsDashboardSkeleton: React.FC = () => (
    <div className="space-y-8 animate-pulse" data-testid={TEST_IDS.ANALYTICS_SKELETON}>
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
    isProUser: effectiveIsProUser,
    sessionHistory,
    overallStats,
    fillerWordTrends,
    loading,
    error,
    onUpgrade,
    onUpdateGroundTruth,
    sessionId
}) => {
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !sessionId || !onUpdateGroundTruth) return;

        try {
            setIsUploading(true);
            const { extractTextFromPdf } = await import('@/lib/pdfParser');
            const text = await extractTextFromPdf(file);
            await onUpdateGroundTruth(sessionId, text);
            toast.success('Reference script uploaded and metrics updated!');
        } catch (err) {
            logger.error({ err }, 'Failed to parse or upload PDF');
            toast.error('Failed to process PDF. Please try again.');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };
    const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
    const [showComparison, setShowComparison] = useState(false);

    // Analysis slide selection state with localStorage persistence
    const [selectedAnalysisSlides, setSelectedAnalysisSlides] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem(ANALYSIS_STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                // Validate that saved slides still exist in options
                const validSlides = normalizeAnalysisSlideIds(parsed);
                if (validSlides.length >= 1) {
                    return validSlides;
                }
            }
        } catch (e) {
            logger.warn('Failed to load saved analysis slide preferences');
        }
        return DEFAULT_ANALYSIS_SLIDES;
    });

    const isProUser = effectiveIsProUser ?? checkIsPro(profile?.subscription_status);

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
            logger.warn('Failed to load saved stat card preferences');
        }
        return DEFAULT_SELECTED_CARDS;
    });

    // Save to localStorage when selection changes
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedStatCards));
        } catch (e) {
            logger.warn('Failed to save stat card preferences');
        }
    }, [selectedStatCards]);

    // Optimization: Memoize filtered stat cards for O(1) lookup in render path
    const displayedStatCards = useMemo(() => {
        const selectedSet = new Set(selectedStatCards);
        return STAT_CARD_OPTIONS.filter(option => selectedSet.has(option.id));
    }, [selectedStatCards]);

    // Carousel API state
    const [api, setApi] = useState<CarouselApi>();
    const [current, setCurrent] = useState(0);
    const [count, setCount] = useState(0);
    const pendingAnalysisSlideIndexRef = useRef<number | null>(null);

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
            api.reInit();
            setCount(api.scrollSnapList().length);
            const pendingIndex = pendingAnalysisSlideIndexRef.current;
            if (pendingIndex !== null) {
                pendingAnalysisSlideIndexRef.current = null;
                const targetIndex = Math.min(pendingIndex, Math.max(api.scrollSnapList().length - 1, 0));
                window.requestAnimationFrame(() => {
                    api.scrollTo(targetIndex);
                    setCurrent(targetIndex + 1);
                });
                return;
            }
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
            logger.warn('Failed to save analysis slide preferences');
        }
    }, [selectedAnalysisSlides]);

    // Optimization: Memoize filtered analysis slides for O(1) lookup in render path
    const displayedAnalysisSlides = useMemo(() => {
        const optionsById = new Map(ANALYSIS_SLIDE_OPTIONS.map(option => [option.id, option]));
        return selectedAnalysisSlides
            .map(id => optionsById.get(id))
            .filter((option): option is AnalysisSlideConfig => Boolean(option));
    }, [selectedAnalysisSlides]);

    const activeAnalysisIndex = current > 0 ? current - 1 : 0;

    const toggleAnalysisSlide = (slideId: string) => {
        setSelectedAnalysisSlides(prev => {
            if (prev.includes(slideId)) {
                if (prev.length <= 1) return prev;
                const removedIndex = prev.indexOf(slideId);
                pendingAnalysisSlideIndexRef.current = Math.min(removedIndex, prev.length - 2);
                return prev.filter(id => id !== slideId);
            }

            if (prev.length >= 4) {
                const replaceIndex = Math.min(Math.max(current - 1, 0), prev.length - 1);
                pendingAnalysisSlideIndexRef.current = replaceIndex;
                return prev.map((id, index) => index === replaceIndex ? slideId : id);
            }

            pendingAnalysisSlideIndexRef.current = prev.length;
            return [...prev, slideId];
        });
    };

    const toggleSessionSelection = useCallback((sessionId: string) => {
        setSelectedSessions(prev =>
            prev.includes(sessionId)
                ? prev.filter(id => id !== sessionId)
                : prev.length < 2
                    ? [...prev, sessionId]
                    : prev
        );
    }, []);

    const selectedSessionData = useMemo(() => {
        if (selectedSessions.length !== 2 || !sessionHistory) return null;
        const sessions = selectedSessions.map(id => sessionHistory.find(s => s.id === id)).filter(Boolean);
        if (sessions.length !== 2) return null;
        return sessions.map(s => {
            const metrics = getSessionAnalysisMetrics(s!);
            return {
                id: s!.id,
                created_at: s!.created_at,
                wpm: metrics.wpm,
                clarity_score: metrics.clarityScore,
                filler_count: metrics.fillerCount,
                duration_seconds: s!.duration,
            };
        }) as [{ id: string; created_at: string; wpm: number; clarity_score: number; filler_count: number; duration_seconds: number }, { id: string; created_at: string; wpm: number; clarity_score: number; filler_count: number; duration_seconds: number }];
    }, [selectedSessions, sessionHistory]);

    const trendData = useMemo(() => {
        if (!sessionHistory || sessionHistory.length < 2) return [];
        return sessionHistory.slice(0, 10).reverse().map(s => {
            const metrics = getSessionAnalysisMetrics(s);
            return {
                date: formatDate(s.created_at),
                wpm: metrics.wpm,
                clarity: metrics.clarityScore,
                fillers: metrics.fillerCount,
            };
        });
    }, [sessionHistory]);

    logger.debug({ loading, error, sessions: sessionHistory?.length }, '[AnalyticsDashboard] Rendering');

    const targetSession = useMemo(() => {
        if (!sessionId || !sessionHistory) return null;
        return sessionHistory.find(s => s.id === sessionId);
    }, [sessionId, sessionHistory]);
    const targetSessionMetrics = useMemo(
        () => targetSession ? getSessionAnalysisMetrics(targetSession) : null,
        [targetSession]
    );

    return (
        <div className="space-y-8" data-testid={TEST_IDS.ANALYTICS_DASHBOARD}>
            {loading ? (
                <AnalyticsDashboardSkeleton />
            ) : error ? (
                <ErrorDisplay error={error} />
            ) : targetSession && targetSessionMetrics ? (
                /* Session Detail View */
                <div className="space-y-8">
                    {/* Session Metrics Summary */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                        <StatCard
                            icon={<Gauge />}
                            label="Speaking Pace"
                            value={targetSessionMetrics.wpm}
                            unit="WPM"
                            description={targetSessionMetrics.wpmExplanation}
                            testId={TEST_IDS.STAT_CARD_SPEAKING_PACE}
                        />
                        <StatCard
                            icon={<Target />}
                            label="Clarity Score"
                            value={targetSessionMetrics.isClarityScorable ? targetSessionMetrics.clarityScore : '--'}
                            unit={targetSessionMetrics.isClarityScorable ? '%' : undefined}
                            description={targetSessionMetrics.clarityExplanation}
                            testId={TEST_IDS.CLARITY_SCORE_VALUE}
                        />
                        <StatCard
                            icon={<TrendingUp />}
                            label="Filler Words"
                            value={targetSessionMetrics.fillerCount}
                            description={targetSessionMetrics.fillerExplanation}
                            testId={TEST_IDS.FILLER_COUNT_VALUE}
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Transcript Panel */}
                        <Card className="lg:col-span-2">
                            <CardHeader className="flex flex-row items-center justify-between">
                                <CardTitle className="flex items-center gap-2">
                                    <Mic className="h-5 w-5 text-primary" />
                                    Transcript
                                </CardTitle>
                                <div className="flex items-center gap-2">
                                    {isProUser && (
                                        <>
                                            <input
                                                type="file"
                                                ref={fileInputRef}
                                                accept=".pdf"
                                                onChange={(e) => { void handleFileUpload(e); }}
                                                className="hidden"
                                            />
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => fileInputRef.current?.click()}
                                                disabled={isUploading}
                                                className="gap-2 border-primary/30 hover:bg-primary/5"
                                                data-testid="upload-ground-truth-btn"
                                            >
                                                <Target className={`h-4 w-4 ${isUploading ? 'animate-spin' : ''}`} />
                                                {targetSession.ground_truth ? 'Update Script' : 'Upload Script'}
                                            </Button>
                                        </>
                                    )}
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => { void generateSessionPdf(targetSession, profile?.email || 'User', isProUser); }}
                                        className="gap-2"
                                    >
                                        <Download className="h-4 w-4" />
                                        Export PDF
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                                    <span className="uppercase tracking-wider">Recorded with</span>
                                    <span className="rounded-md border border-[hsl(var(--border))] bg-muted px-2 py-1 text-foreground" data-testid="session-engine-metadata">
                                        {formatSessionRecordingMode(targetSession)}
                                    </span>
                                </div>
                                <div className="p-4 bg-muted rounded-lg border border-[hsl(var(--border))] min-h-[150px] max-h-[300px] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
                                    {targetSession.transcript || "No transcript available for this session."}
                                </div>

                                {targetSession.ground_truth && (
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                            <Target className="h-3 w-3" />
                                            Reference Script (Ground Truth)
                                        </div>
                                        <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg max-h-[150px] overflow-y-auto whitespace-pre-wrap text-sm italic text-muted-foreground">
                                            {targetSession.ground_truth}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* AI Suggestions Panel */}
                        <div className="h-full">
                            <AISuggestions
                                transcript={targetSession.transcript || ""}
                                sessionId={targetSession.id}
                                initialSuggestions={targetSession.ai_suggestions}
                                metrics={{
                                    wpm: targetSession.wpm,
                                    clarity_score: targetSession.clarity_score,
                                    total_words: targetSession.total_words,
                                    duration: targetSession.duration,
                                    filler_words: targetSession.filler_words,
                                    pause_metrics: targetSession.pause_metrics
                                }}
                            />
                        </div>
                    </div>

                    <div className="flex justify-center pt-4">
                        <Button asChild variant="ghost" className="gap-2">
                            <NavLink to="/analytics">
                                <BarChart className="h-4 w-4" />
                                Back to Dashboard
                            </NavLink>
                        </Button>
                    </div>
                </div>
            ) : !sessionHistory || sessionHistory.length === 0 ? (
                <EmptyState
                    title="Your Dashboard Awaits!"
                    description="Record your next session to unlock your progress trends and full analytics!"
                    action={{
                        label: "Get Started",
                        href: "/session"
                    }}
                    icon={<BarChart className="w-10 h-10 text-primary" />}
                    testId={TEST_IDS.ANALYTICS_EMPTY_STATE}
                    // Subtle upgrade option for BASIC users - triggers Stripe checkout directly
                    secondaryAction={!isProUser ? {
                        prefix: "Want unlimited sessions?",
                        label: "Upgrade to Pro",
                        onClick: onUpgrade,
                        testId: TEST_IDS.ANALYTICS_UPGRADE_BUTTON
                    } : undefined}
                />
            ) : (
                <>

                    {/* Stats Section Header with Settings */}
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-foreground">Overview</h2>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="gap-2 hover:bg-primary/10 hover:text-primary">
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
                        {displayedStatCards.map(option => (
                            <StatCard
                                key={option.id}
                                icon={option.icon}
                                label={option.label}
                                value={option.getValue(overallStats)}
                                unit={option.unit}
                                testId={`stat-card-${option.id}`}
                            />
                        ))}
                    </div>

                    <GoalsSection />

                    {/* Analysis Section Header with Settings */}
                    <div className="flex items-center justify-between pt-4">
                        <div className="space-y-1">
                            <h2 className="text-xl font-semibold text-foreground">Speech Pattern Analysis</h2>
                            <p className="text-sm text-muted-foreground">Deep dive into your speaking performance</p>
                        </div>
                        <DropdownMenu open={isAnalysisMenuOpen} onOpenChange={setIsAnalysisMenuOpen}>
                            <DropdownMenuTrigger asChild onMouseEnter={openAnalysisMenu} onMouseLeave={closeAnalysisMenu}>
                                <Button variant="ghost" size="sm" className="gap-2 hover:bg-primary/10 hover:text-primary">
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
                                {displayedAnalysisSlides.map((option, index) => (
                                    <CarouselItem key={option.id} className="basis-full">
                                        <div className="p-1">
                                            {index === activeAnalysisIndex ? (
                                                <>
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
                                                    {option.id === 'filler_words' && (
                                                        <Card>
                                                            <CardHeader><CardTitle>Filler Words</CardTitle></CardHeader>
                                                            <CardContent className="space-y-6">
                                                                {overallStats.chartData.length > 1 ? (
                                                                    <FillerWordsTrendChart data={overallStats.chartData} />
                                                                ) : (
                                                                    <div className="flex items-center justify-center h-[220px] text-center text-muted-foreground"><p>Complete at least two sessions to see your filler word trend.</p></div>
                                                                )}
                                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                                    <TopFillerWords />
                                                                    <FillerWordTable trendData={fillerWordTrends} />
                                                                </div>
                                                            </CardContent>
                                                        </Card>
                                                    )}
                                                    {option.id === 'stt_comparison' && (
                                                        <STTAccuracyVsBenchmark />
                                                    )}
                                                </>
                                            ) : (
                                                <div className="min-h-[360px]" aria-hidden="true" />
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
                            <Card className="rounded-xl p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <div>
                                        <h2 className="text-xl font-bold text-foreground">Download PDF Reports</h2>
                                        <p className="text-sm text-muted-foreground mt-1">Generate local PDF downloads from your saved session data.</p>
                                        <div className="mt-3 flex items-center gap-2 text-[10px] md:text-xs font-semibold uppercase tracking-wider bg-secondary/10 text-secondary border border-secondary/20 px-3 py-1.5 rounded-full inline-flex">
                                            <Activity className="h-3 w-3" />
                                            <span>Rolling History: Last 50 Sessions Kept</span>
                                        </div>
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
                                        sessionHistory.map((session) => (
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
                                        <div className="text-center py-12 text-muted-foreground bg-muted rounded-xl border border-dashed border-[hsl(var(--border-strong))]">
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
