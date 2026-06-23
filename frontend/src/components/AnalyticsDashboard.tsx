import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { TrendingUp, Clock, Layers, Download, Target, Gauge, BarChart, Settings, Activity, Mic, Cloud, Lock, Monitor, Eye, ChevronDown } from 'lucide-react';
import logger from '../lib/logger';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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
import { getTranscriptQualityCaveat } from '@/utils/speakingScore';

import type { PracticeSession } from '@/types/session';
import type { UserProfile } from '@/types/user';
import type { FillerWordTrends, OverallStats } from '@/types/analytics';
import { EmptyState } from '@/components/ui/EmptyState';
import { TEST_IDS } from '@/constants/testIds';
import { isPro as checkIsPro } from '@/constants/subscriptionTiers';
import { arePaymentsEnabled } from '@/config/appRuntimeConfig';

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
    sessionHistory: PracticeSession[];
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
        <div ref={chartContainer.ref} className="h-[210px] w-full">
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
        icon: <Layers size={24} className="text-foreground/70" />,
        getValue: (stats) => stats.totalSessions,
        description: 'Number of practice sessions completed'
    },
    {
        id: 'speaking_pace',
        label: 'Speaking Pace',
        icon: <Gauge size={24} className="text-foreground/70" />,
        getValue: (stats) => stats.averageWPM,
        unit: 'WPM',
        description: 'Average words per minute'
    },
    {
        id: 'filler_words_per_min',
        label: 'Avg. Filler Words / Min',
        icon: <TrendingUp size={24} className="text-foreground/70" />,
        getValue: (stats) => stats.avgFillerWordsPerMin,
        description: 'Filler word frequency per minute'
    },
    {
        id: 'total_practice_time',
        label: 'Total Practice Time',
        icon: <Clock size={24} className="text-foreground/70" />,
        getValue: (stats) => stats.totalPracticeTime,
        unit: 'mins',
        description: 'Total time spent practicing'
    },
    {
        id: 'clarity_score',
        label: 'Clarity Score',
        icon: <Target size={24} className="text-foreground/70" />,
        getValue: (stats) => stats.avgAccuracy,
        unit: '%',
        description: 'Average speech clarity percentage'
    },
    // Future stat cards can be added here
    {
        id: 'avg_session_length',
        label: 'Avg. Session Length',
        icon: <Activity size={24} className="text-foreground/70" />,
        getValue: (stats) => stats.averageSessionLength,
        unit: 'mins',
        description: 'Average duration per session'
    },
];

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
            label: 'Browser',
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

type AnalyticsToolGroupId = 'speak_clearly' | 'sound_confident' | 'track_progress';
type AnalyticsFocusId = AnalyticsToolGroupId | 'custom';

type AnalyticsToolGroup = {
    id: AnalyticsToolGroupId;
    label: string;
    purpose: string;
    outcome: string;
    statCardIds: string[];
    analysisSlideIds: string[];
};

const ANALYTICS_TOOL_GROUPS: AnalyticsToolGroup[] = [
    {
        id: 'speak_clearly',
        label: 'Speak Clearly',
        purpose: 'Helps you see whether your message is clear, concise, and supported by a trustworthy transcript.',
        outcome: 'Use it when you want the next take to land with a sharper point and less repetition.',
        statCardIds: ['clarity_score', 'avg_session_length', 'filler_words_per_min', 'total_sessions'],
        analysisSlideIds: ['clarity_trend', 'stt_comparison', 'filler_words', 'weekly_activity'],
    },
    {
        id: 'sound_confident',
        label: 'Sound Confident',
        purpose: 'Shows whether your pace, pauses, fillers, and delivery habits make you easy to follow.',
        outcome: 'Use it when you want your next session to sound steadier, calmer, and more confident.',
        // Default focus: stat cards AND analysis-slide order are kept identical to the prior default
        // (legacy 'delivery_control') so existing users' default dashboard is unchanged by the rename.
        statCardIds: ['speaking_pace', 'filler_words_per_min', 'clarity_score', 'total_practice_time'],
        analysisSlideIds: ['pace_trend', 'filler_words', 'clarity_trend', 'weekly_activity'],
    },
    {
        id: 'track_progress',
        label: 'Track Progress',
        purpose: 'Turns saved sessions, goals, comparisons, and reports into evidence that your practice is improving.',
        outcome: 'Use it when you want proof of what changed and what to try again next.',
        statCardIds: ['total_sessions', 'total_practice_time', 'avg_session_length', 'clarity_score'],
        analysisSlideIds: ['weekly_activity', 'clarity_trend', 'pace_trend', 'filler_words'],
    },
];

// Default to Sound Confident (successor of the prior default Delivery Control), so the default
// dashboard keeps its existing stat cards + charts — only the theme label changes. Unknown/corrupt
// stored values resolve here too. Speak Clearly stays a primary theme but is not the release default.
const DEFAULT_ANALYTICS_TOOL_GROUP: AnalyticsToolGroupId = 'sound_confident';
const TOOL_GROUP_STORAGE_KEY = 'speaksharp_analytics_tool_group_v1';
const CUSTOM_STAT_STORAGE_KEY = 'speaksharp_custom_stat_cards_v1';
const CUSTOM_ANALYSIS_STORAGE_KEY = 'speaksharp_custom_analysis_slides_v1';
const DEFAULT_CUSTOM_STAT_CARDS = ['speaking_pace', 'filler_words_per_min', 'clarity_score', 'total_practice_time'];
const DEFAULT_CUSTOM_ANALYSIS_SLIDES = ['pace_trend', 'clarity_trend', 'weekly_activity', 'filler_words'];

const LEGACY_ANALYTICS_FOCUS_MAP: Record<string, AnalyticsFocusId> = {
    delivery_control: 'sound_confident',
    message_clarity: 'speak_clearly',
    habit_progress: 'track_progress',
    session_proof: 'track_progress',
    transcript_quality: 'speak_clearly',
    custom_toolkit: 'custom',
};

const normalizeAnalyticsFocusId = (saved: string | null): AnalyticsFocusId | null => {
    if (!saved) return null;
    if (saved === 'custom') return 'custom';
    if (ANALYTICS_TOOL_GROUPS.some(group => group.id === saved)) {
        return saved as AnalyticsToolGroupId;
    }
    return LEGACY_ANALYTICS_FOCUS_MAP[saved] ?? null;
};

const normalizeStatCardIds = (ids: string[]): string[] => {
    const validIds = new Set(STAT_CARD_OPTIONS.map(option => option.id));
    const normalized = ids.filter(id => validIds.has(id));
    return normalized.length > 0 ? normalized.slice(0, 4) : DEFAULT_CUSTOM_STAT_CARDS;
};

const normalizeAnalysisSlideIds = (ids: string[]): string[] => {
    const validIds = new Set(ANALYSIS_SLIDE_OPTIONS.map(option => option.id));
    const normalized = ids.filter(id => validIds.has(id));
    return normalized.length > 0 ? normalized.slice(0, 4) : DEFAULT_CUSTOM_ANALYSIS_SLIDES;
};

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
                {unit && <span className="ml-1 text-sm font-semibold text-foreground/70">{unit}</span>}
            </div>
            <p className="mt-1 text-sm font-semibold text-foreground/75">{label}</p>
            {description && (
                <p className="mt-3 text-xs font-medium leading-snug text-foreground/70" data-testid={`${testId || `stat-card-${label.toLowerCase().replace(/\s+/g, '-')}`}-explanation`}>
                    {description}
                </p>
            )}
        </div>
    </Card>
);

const SessionHistoryItem: React.FC<SessionHistoryItemProps> = ({ session, sessionHistory, isPro: _isPro, isSelected, onToggleSelect, profileName }) => {
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
            className="group flex flex-col md:flex-row items-center justify-between p-4 bg-muted rounded-xl hover:bg-white transition-colors border border-[hsl(var(--border))] hover:border-[hsl(var(--border-strong))] surface-shadow mb-3 last:mb-0"
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
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground/70">
                            <Clock className="w-3 h-3" />
                            <span>{durationStr} duration</span>
                            <span className="text-foreground/50">•</span>
                            <span>{formatDateTime(session.created_at)}</span>
                        </div>
                    </div>
                </NavLink>
            </div>

            <div className="flex items-center gap-8 w-full md:w-auto justify-between md:justify-end px-4 md:px-0">
                <div className="text-center">
                    <p className="font-bold text-foreground text-lg">{wpm}</p>
                    <p className="text-xs font-bold uppercase tracking-wider text-foreground/70">WPM</p>
                </div>
                <div className="text-center">
                    <p className={`font-bold text-lg ${totalFillers <= 3 ? "text-success" : "text-primary"}`}>
                        {totalFillers}
                    </p>
                    <p className="text-xs font-bold uppercase tracking-wider text-foreground/70">Fillers</p>
                </div>
                <div className="text-center">
                    <p className="font-bold text-primary text-lg">{typeof clarity === 'number' ? clarity.toFixed(0) : '0'}%</p>
                    <p className="text-xs font-bold uppercase tracking-wider text-foreground/70">Clarity</p>
                </div>

                <div className="pl-4 border-l border-border hidden md:block" data-testid={`download-pdf-container-${session.id}`}>
                    <NavLink
                        to={`/analytics/${session.id}`}
                        className="mb-2 inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[hsl(var(--border-strong))] bg-white px-3 text-sm font-semibold text-foreground surface-shadow transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label="Open saved session details"
                        data-testid={`open-session-detail-${session.id}`}
                    >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                        Open
                    </NavLink>
                    <Button
                        variant="secondary"
                        size="sm"
                        className="gap-2 hover:bg-primary hover:text-primary-foreground transition-colors surface-shadow"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void generateSessionPdf(session, profileName, _isPro, sessionHistory);
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
                        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-[hsl(var(--border-strong))] bg-white px-3 text-sm font-semibold text-foreground surface-shadow transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label="Open saved session details"
                        data-testid={`open-session-detail-mobile-${session.id}`}
                    >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                        Open Saved Session
                    </NavLink>
                    <Button
                        variant="secondary"
                        size="sm"
                        className="w-full gap-2"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void generateSessionPdf(session, profileName, _isPro, sessionHistory);
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
    sessionId
}) => {
    const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
    const [showComparison, setShowComparison] = useState(false);

    const [selectedFocusId, setSelectedFocusId] = useState<AnalyticsFocusId>(() => {
        try {
            const saved = localStorage.getItem(TOOL_GROUP_STORAGE_KEY);
            const normalized = normalizeAnalyticsFocusId(saved);
            if (normalized) return normalized;
        } catch (e) {
            logger.warn('Failed to load saved analytics focus preference');
        }
        return DEFAULT_ANALYTICS_TOOL_GROUP;
    });

    const isProUser = effectiveIsProUser ?? checkIsPro(profile?.subscription_status);
    const [customStatCards, setCustomStatCards] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem(CUSTOM_STAT_STORAGE_KEY);
            if (saved) return normalizeStatCardIds(JSON.parse(saved));
        } catch (e) {
            logger.warn('Failed to load custom stat card preferences');
        }
        return DEFAULT_CUSTOM_STAT_CARDS;
    });
    const [customAnalysisSlides, setCustomAnalysisSlides] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem(CUSTOM_ANALYSIS_STORAGE_KEY);
            if (saved) return normalizeAnalysisSlideIds(JSON.parse(saved));
        } catch (e) {
            logger.warn('Failed to load custom analysis preferences');
        }
        return DEFAULT_CUSTOM_ANALYSIS_SLIDES;
    });
    const selectedToolGroup = useMemo(
        () => ANALYTICS_TOOL_GROUPS.find(group => group.id === selectedFocusId) ?? ANALYTICS_TOOL_GROUPS[0],
        [selectedFocusId]
    );
    const isCustomFocus = selectedFocusId === 'custom';

    useEffect(() => {
        try {
            localStorage.setItem(TOOL_GROUP_STORAGE_KEY, selectedFocusId);
        } catch (e) {
            logger.warn('Failed to save analytics focus preference');
        }
    }, [selectedFocusId]);

    useEffect(() => {
        try {
            localStorage.setItem(CUSTOM_STAT_STORAGE_KEY, JSON.stringify(customStatCards));
        } catch (e) {
            logger.warn('Failed to save custom stat card preferences');
        }
    }, [customStatCards]);

    useEffect(() => {
        try {
            localStorage.setItem(CUSTOM_ANALYSIS_STORAGE_KEY, JSON.stringify(customAnalysisSlides));
        } catch (e) {
            logger.warn('Failed to save custom analysis preferences');
        }
    }, [customAnalysisSlides]);

    // Optimization: Memoize filtered stat cards for O(1) lookup in render path
    const displayedStatCards = useMemo(() => {
        const selectedSet = new Set(isCustomFocus ? customStatCards : selectedToolGroup.statCardIds);
        return STAT_CARD_OPTIONS.filter(option => selectedSet.has(option.id));
    }, [customStatCards, isCustomFocus, selectedToolGroup]);

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

    // Update count when the analytics focus changes
    useEffect(() => {
        if (api) {
            api.reInit();
            setCount(api.scrollSnapList().length);
            window.requestAnimationFrame(() => {
                api.scrollTo(0);
                setCurrent(1);
            });
        }
    }, [selectedFocusId, api]);

    // Optimization: Memoize filtered analysis slides for O(1) lookup in render path
    const displayedAnalysisSlides = useMemo(() => {
        const optionsById = new Map(ANALYSIS_SLIDE_OPTIONS.map(option => [option.id, option]));
        return (isCustomFocus ? customAnalysisSlides : selectedToolGroup.analysisSlideIds)
            .map(id => optionsById.get(id))
            .filter((option): option is AnalysisSlideConfig => Boolean(option));
    }, [customAnalysisSlides, isCustomFocus, selectedToolGroup]);

    const activeAnalysisIndex = current > 0 ? current - 1 : 0;
    const focusLabel = isCustomFocus ? 'Custom' : selectedToolGroup.label;
    const focusPurpose = isCustomFocus
        ? 'Inspect specific metrics when you already know the signal you want to measure.'
        : selectedToolGroup.purpose;
    const focusOutcome = isCustomFocus
        ? 'Use it as an advanced measurement view after the main improvement goals answer your first question.'
        : selectedToolGroup.outcome;

    const toggleCustomStatCard = (cardId: string) => {
        setCustomStatCards(prev => {
            if (prev.includes(cardId)) {
                if (prev.length <= 1) return prev;
                return prev.filter(id => id !== cardId);
            }
            if (prev.length >= 4) return prev;
            return [...prev, cardId];
        });
    };

    const toggleCustomAnalysisSlide = (slideId: string) => {
        setCustomAnalysisSlides(prev => {
            if (prev.includes(slideId)) {
                if (prev.length <= 1) return prev;
                return prev.filter(id => id !== slideId);
            }
            if (prev.length >= 4) return prev;
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
        const sessionsById = new Map(sessionHistory.map(session => [session.id, session]));
        const sessions = selectedSessions.map(id => sessionsById.get(id)).filter(Boolean);
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
        const sessionsById = new Map(sessionHistory.map(session => [session.id, session]));
        return sessionsById.get(sessionId) ?? null;
    }, [sessionId, sessionHistory]);
    const targetSessionMetrics = useMemo(
        () => targetSession ? getSessionAnalysisMetrics(targetSession) : null,
        [targetSession]
    );
    // Transcript-quality caveat for the saved session — same signal as the live
    // SpeakSharp Score confidence, so a weak-transcript session in history is never
    // presented as a precise grade without the "directional" explanation (Option 2).
    const targetSessionQuality = useMemo(
        () => targetSession
            ? getTranscriptQualityCaveat(targetSession.transcript ?? '', targetSession.engine ?? undefined)
            : null,
        [targetSession]
    );

    return (
        <div className="space-y-6" data-testid={TEST_IDS.ANALYTICS_DASHBOARD}>
            {loading ? (
                <AnalyticsDashboardSkeleton />
            ) : error ? (
                <ErrorDisplay error={error} />
            ) : targetSession && targetSessionMetrics ? (
                /* Session Detail View */
                <div className="space-y-6">
                    {/* Transcript-quality caveat: keep weak/uncertain saved transcripts from
                        reading as a precise grade. Visible (not a hidden detail) when untrusted. */}
                    {targetSessionQuality && !targetSessionQuality.trusted && targetSessionQuality.qualityNote && (
                        <div
                            className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold leading-snug text-amber-900"
                            data-testid="session-detail-quality-caveat"
                            role="note"
                        >
                            <Eye className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{targetSessionQuality.qualityNote}</span>
                        </div>
                    )}

                    {/* Session Metrics Summary */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Transcript Panel */}
                        <Card className="lg:col-span-2">
                            <CardHeader className="flex flex-row items-center justify-between">
                                <CardTitle className="flex items-center gap-2">
                                    <Mic className="h-5 w-5 text-primary" />
                                    Transcript
                                </CardTitle>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => { void generateSessionPdf(targetSession, profile?.email || 'User', isProUser, sessionHistory); }}
                                        className="gap-2"
                                    >
                                        <Download className="h-4 w-4" />
                                        Export PDF
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-foreground/70">
                                    <span className="uppercase tracking-wider">Recorded with</span>
                                    <span
                                        className="rounded-md border border-[hsl(var(--border))] bg-muted px-2 py-1 text-foreground"
                                        data-testid="session-engine-metadata"
                                        data-model={targetSession.model_name ?? ''}
                                        data-engine-version={targetSession.engine_version ?? ''}
                                        data-device-type={targetSession.device_type ?? ''}
                                    >
                                        {formatSessionRecordingMode(targetSession)}
                                    </span>
                                </div>
                                <div
                                    className="p-4 bg-muted rounded-lg border border-[hsl(var(--border))] min-h-[150px] max-h-[300px] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed"
                                    data-testid="session-detail-transcript"
                                    // Authoritative, trimmed transcript value for proof harnesses.
                                    // Empty string here means the saved row carried no real transcript
                                    // (e.g. the start-time `' '` placeholder of an unfinalized session),
                                    // disambiguating a genuine product gap from a wrong selector read.
                                    data-session-detail-transcript={targetSession.transcript?.trim() || ''}
                                >
                                    {targetSession.transcript?.trim() || "No transcript available for this session."}
                                </div>
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

                    <div className="flex justify-center pt-2">
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
                    title="Your trends start after one saved session"
                    description="Save a practice session to see pace, filler words, clarity, PDF reports, and progress history here."
                    action={{
                        label: "Start Practice Session",
                        href: "/session"
                    }}
                    icon={<BarChart className="w-10 h-10 text-primary" />}
                    compact
                    className="mx-auto max-w-3xl border border-border surface-shadow"
                    testId={TEST_IDS.ANALYTICS_EMPTY_STATE}
                    // Subtle upgrade option for Free users — only when payments are live (no dead button)
                    secondaryAction={!isProUser && arePaymentsEnabled() ? {
                        prefix: "Need more recording time?",
                        label: "Upgrade to Pro",
                        onClick: onUpgrade,
                        testId: TEST_IDS.ANALYTICS_UPGRADE_BUTTON
                    } : undefined}
                />
            ) : (
                <>

                    <Card className="rounded-xl border border-border bg-card surface-shadow">
                        <CardHeader className="space-y-4">
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                <div className="space-y-1">
                                    <p className="text-xs font-bold uppercase tracking-wider text-primary">Analytics Focus</p>
                                    <CardTitle className="text-2xl font-extrabold text-foreground">{focusLabel}</CardTitle>
                                    <p className="max-w-3xl text-sm font-semibold leading-snug text-foreground/75">
                                        {focusPurpose}
                                    </p>
                                </div>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="gap-2 self-start border-[hsl(var(--border-strong))] font-semibold text-foreground hover:border-primary hover:bg-primary/10 hover:text-primary"
                                            data-testid={TEST_IDS.ANALYTICS_FOCUS_TRIGGER}
                                        >
                                            Choose focus
                                            <ChevronDown className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-72">
                                        <DropdownMenuLabel>Choose what you want to improve</DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuRadioGroup
                                            value={selectedFocusId}
                                            onValueChange={(value) => setSelectedFocusId(value as AnalyticsFocusId)}
                                        >
                                            {ANALYTICS_TOOL_GROUPS.map(group => (
                                                <DropdownMenuRadioItem key={group.id} value={group.id} className="items-start">
                                                    <span className="flex flex-col gap-0.5">
                                                        <span className="font-semibold">{group.label}</span>
                                                        <span className="text-xs leading-snug text-muted-foreground">{group.outcome}</span>
                                                    </span>
                                                </DropdownMenuRadioItem>
                                            ))}
                                            <DropdownMenuSeparator />
                                            <DropdownMenuRadioItem value="custom" className="items-start">
                                                <span className="flex flex-col gap-0.5">
                                                    <span className="font-semibold">Custom</span>
                                                    <span className="text-xs leading-snug text-muted-foreground">Advanced: choose specific metrics when you already know what to inspect.</span>
                                                </span>
                                            </DropdownMenuRadioItem>
                                        </DropdownMenuRadioGroup>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                            <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm font-semibold leading-snug text-foreground/75">
                                {focusOutcome}
                            </div>
                            <div className="grid gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-4 text-sm leading-snug text-foreground/80 md:grid-cols-[1fr_auto] md:items-center">
                                <div className="space-y-1">
                                    <p className="font-bold text-foreground">Why these tools are here</p>
                                    <p className="font-medium">
                                        Pace, fillers, clarity, activity, and transcript quality are the evidence behind SpeakSharp Score and your coaching feedback.
                                    </p>
                                </div>
                                <div className="rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground/75 md:max-w-[260px]">
                                    {isCustomFocus
                                        ? 'Custom metrics answer their own question without changing the main coaching story.'
                                        : `${focusLabel} shows which ingredient to improve before your next session.`}
                                </div>
                            </div>
                        </CardHeader>
                    </Card>

                    {/* Stats Section Header */}
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="space-y-1">
                            <h2 className="text-lg font-semibold text-foreground">Evidence for {focusLabel}</h2>
                            <p className="text-sm font-medium text-foreground/70">
                                {isCustomFocus ? 'Selected tools are interpreted independently.' : 'These cards are selected together because they support the current focus.'}
                            </p>
                        </div>
                        {isCustomFocus && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm" className="gap-2 hover:bg-primary/10 hover:text-primary">
                                        <Settings className="h-4 w-4" />
                                        Choose Stat Cards
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-64">
                                    <DropdownMenuLabel>Display Stats ({customStatCards.length}/4)</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    {STAT_CARD_OPTIONS.map(option => (
                                        <DropdownMenuCheckboxItem
                                            key={option.id}
                                            checked={customStatCards.includes(option.id)}
                                            onCheckedChange={() => toggleCustomStatCard(option.id)}
                                            disabled={
                                                (!customStatCards.includes(option.id) && customStatCards.length >= 4) ||
                                                (customStatCards.includes(option.id) && customStatCards.length <= 1)
                                            }
                                        >
                                            {option.label}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                    </div>

                    {/* Dynamic Stat Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

                    {/* Analysis Section Header */}
                    <div className="flex items-center justify-between pt-2">
                        <div className="space-y-1">
                            <h2 className="text-xl font-semibold text-foreground">{focusLabel} Tools</h2>
                            <p className="text-sm font-medium text-foreground/70">
                                {isCustomFocus ? 'Each selected chart keeps its own standalone interpretation.' : 'Each chart answers part of the same coaching question.'}
                            </p>
                        </div>
                        {isCustomFocus && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm" className="gap-2 hover:bg-primary/10 hover:text-primary">
                                        <Settings className="h-4 w-4" />
                                        Choose Analysis Tools
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-64">
                                    <DropdownMenuLabel>Display Analysis ({customAnalysisSlides.length}/4)</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    {ANALYSIS_SLIDE_OPTIONS.map(option => (
                                        <DropdownMenuCheckboxItem
                                            key={option.id}
                                            checked={customAnalysisSlides.includes(option.id)}
                                            onCheckedChange={() => toggleCustomAnalysisSlide(option.id)}
                                            disabled={
                                                (!customAnalysisSlides.includes(option.id) && customAnalysisSlides.length >= 4) ||
                                                (customAnalysisSlides.includes(option.id) && customAnalysisSlides.length <= 1)
                                            }
                                        >
                                            {option.label}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                    </div>

                    {/* Analysis Carousel */}
                    <div className="space-y-2">
                        <Carousel className="w-full" opts={{ loop: true }} setApi={setApi}>
                            <CarouselContent>
                                {displayedAnalysisSlides.map((option, index) => (
                                    <CarouselItem key={option.id} className="basis-full">
                                        <div>
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
                                                                    <div className="flex h-[150px] items-center justify-center rounded-lg border border-dashed border-[hsl(var(--border-strong))] bg-muted/70 px-6 text-center text-sm font-semibold text-foreground/75"><p>Complete at least two sessions to see your filler word trend.</p></div>
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
                                                <div className="min-h-[240px]" aria-hidden="true" />
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
                        <div className="flex justify-center gap-2 py-1">
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
                            <Card className="rounded-xl p-5">
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <h2 className="text-xl font-bold text-foreground">Download PDF Reports</h2>
                                        <p className="mt-1 text-sm font-medium text-foreground/70">Generate local PDF downloads from your saved session data.</p>
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
                                <div className="space-y-3" data-testid={TEST_IDS.SESSION_HISTORY_LIST}>
                                    {sessionHistory && sessionHistory.length > 0 ? (
                                        sessionHistory.map((session) => (
                                            <SessionHistoryItem
                                                key={session.id}
                                                session={session}
                                                sessionHistory={sessionHistory}
                                                isPro={isProUser}
                                                isSelected={selectedSessions.includes(session.id)}
                                                onToggleSelect={toggleSessionSelection}
                                                profileName={profile?.email || 'User'}
                                            />
                                        ))
                                    ) : (
                                        <div className="rounded-xl border border-dashed border-[hsl(var(--border-strong))] bg-muted py-12 text-center font-semibold text-foreground/75">
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
