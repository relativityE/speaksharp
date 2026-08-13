import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { isValidMetric, formatDurationMinutes, NOT_ENOUGH_DATA } from '@/utils/metricValidity';
import { presentTranscript, transcriptDerivedMetricShowable, TRANSCRIPT_STATE } from '@/constants/transcriptState';
import { NavLink } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { TrendingUp, Clock, Layers, Download, Target, Gauge, BarChart, Settings, Activity, Mic, Eye, ChevronDown, AudioLines } from 'lucide-react';
import logger from '../lib/logger';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ProgressPanel } from '@/components/progress/ProgressPanel';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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
import { getSessionAnalysisMetrics, calculateRatePerMinute, isUsableFillerCounts } from '@/utils/sessionAnalysis';
import { getSessionPauseCount } from '@/lib/analyticsUtils';
import {
    decodePace,
    decodePauseRhythm,
    decodeFillers,
    decodeClarity,
    getNarrativeSummary,
    type CoachingMetric,
} from '@/utils/coachingNarrative';
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
    value: string | number | null;
    unit?: string;
    description?: string;
    microcopy?: string;
    interpretation?: CoachingMetric;
    className?: string;
    testId?: string;
}

// #G4 §2: one chip scale + number color for the four signal cards. `nodata` = no evidence yet (NEED 2 MORE),
// `ontrack` = on target (good), `fix` = needs attention (watch/off). Colors from the four-role palette.
type G4Status = 'fix' | 'ontrack' | 'nodata';
const G4_CHIP: Record<G4Status, { text: string; cls: string }> = {
    fix: { text: 'FIX THIS', cls: 'bg-[#fdf3e2] text-[#8a5510]' },
    ontrack: { text: 'ON TRACK', cls: 'bg-[#e7f4ed] text-[#146b4a]' },
    nodata: { text: 'NEED 2 MORE', cls: 'bg-[#eef1f6] text-[#5a6472]' },
};
const G4_NUM_COLOR: Record<G4Status, string> = {
    fix: 'text-[#a8321f]',
    ontrack: 'text-[#146b4a]',
    nodata: 'text-[#8b95a5]',
};

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
    getValue: (stats: OverallStats) => string | number | null;
    unit?: string;
    description?: string;
    // Short supporting microcopy shown under the (now secondary) number on a decoded card.
    microcopy?: string;
    // Narrative-first: decode the raw value into a plain label (Fast / Choppy / Strong …) so the card
    // leads with the coaching read and keeps the number as secondary detail.
    getInterpretation?: (stats: OverallStats) => CoachingMetric;
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
        description: 'Average words per minute',
        microcopy: 'Target 130–150',
        getInterpretation: (stats) => decodePace(stats.averageWPM),
    },
    {
        id: 'filler_words_per_min',
        label: 'Avg. Filler Words / Min',
        icon: <TrendingUp size={24} className="text-foreground/70" />,
        getValue: (stats) => stats.avgFillerWordsPerMin,
        unit: '/min',
        description: 'Filler word frequency per minute',
        microcopy: 'Swap a filler for a brief pause',
        getInterpretation: (stats) => decodeFillers(stats.avgFillerWordsPerMin),
    },
    {
        id: 'total_practice_time',
        label: 'Total Practice Time',
        icon: <Clock size={24} className="text-foreground/70" />,
        // #1045: formatted from exact seconds so a real but short total reads "<1 min", never "0 mins".
        getValue: (stats) => formatDurationMinutes(stats.totalPracticeTimeSeconds),
        description: 'Total time spent practicing'
    },
    {
        id: 'clarity_score',
        label: 'Clear Delivery',
        icon: <Target size={24} className="text-foreground/70" />,
        getValue: (stats) => stats.avgClarity,
        unit: '%',
        description: 'Based on pace, fillers, and structure — not transcription accuracy.',
        microcopy: 'Pace + fillers + structure',
        getInterpretation: (stats) => decodeClarity(stats.avgClarity),
    },
    {
        id: 'pause_rhythm',
        label: 'Pause Rhythm',
        icon: <AudioLines size={24} className="text-foreground/70" />,
        getValue: (stats) => stats.avgPausesPerMin,
        unit: '/min',
        description: 'Pauses per minute. Healthy pauses make key ideas easier to follow.',
        microcopy: 'Steady spacing helps ideas land',
        getInterpretation: (stats) => decodePauseRhythm(stats.avgPausesPerMin),
    },
    // Future stat cards can be added here
    {
        id: 'avg_session_length',
        label: 'Avg. Session Length',
        icon: <Activity size={24} className="text-foreground/70" />,
        // #1045: Math.round turned every sub-30s average into the flatly false "0 mins".
        getValue: (stats) => formatDurationMinutes(stats.averageSessionLengthSeconds),
        description: 'Average duration per session'
    },
];

// #G4 chunk 3: getEngineBadge removed with the per-row engine/PRIVATE badge (the section footer carries
// the privacy promise; current Private versus neutral historical recording provenance remains visible).

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
        label: 'Clear Delivery Trend',
        description: 'Monitor your speech clarity percentage'
    },
    {
        id: 'pause_trend',
        label: 'Pause Rhythm Trend',
        description: 'Pauses per minute across your sessions'
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
        // Default focus: the delivery toolkit. Pause Rhythm is first-class here so the cards match the
        // promise ("pace, pauses, fillers, and delivery") — it takes the slots the progress-oriented
        // total_practice_time / weekly_activity held, which belong to the Track Progress focus.
        statCardIds: ['speaking_pace', 'pause_rhythm', 'filler_words_per_min', 'clarity_score'],
        analysisSlideIds: ['pace_trend', 'pause_trend', 'filler_words', 'clarity_trend'],
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
const DEFAULT_CUSTOM_STAT_CARDS = ['speaking_pace', 'pause_rhythm', 'filler_words_per_min', 'clarity_score'];
const DEFAULT_CUSTOM_ANALYSIS_SLIDES = ['pace_trend', 'pause_trend', 'clarity_trend', 'filler_words'];

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

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, unit, description, microcopy, interpretation, className = '', testId }) => {
    const resolvedTestId = testId || `stat-card-${label.toLowerCase().replace(/\s+/g, '-')}`;

    // #1045: a card may only show a number, a unit, or a judgment when the evidence supports it.
    // `Not enough data` is itself a valid rendered value, so it must not be re-suppressed.
    const evidenceMissing = interpretation?.isEvidenceMissing === true
        || (value !== NOT_ENOUGH_DATA && !isValidMetric(value));
    const displayValue = evidenceMissing ? NOT_ENOUGH_DATA : value;
    // The unit goes with the number. A lone "%" or "/min" beside "Not enough data" is the same false
    // precision in smaller type.
    const displayUnit = evidenceMissing ? undefined : unit;

    // Narrative-first: when the value is decoded into a coaching label, the LABEL is the anchor and
    // the raw number drops to small supporting detail (action first, reason second, metrics third).
    if (interpretation) {
        // #G4 §2: every signal card is the SAME four parts in the same order — name, status chip, coloured
        // number+unit, one sentence. `nodata` states its unlock path instead of a dead "Not enough data".
        const status: G4Status = evidenceMissing ? 'nodata' : (interpretation.tone === 'good' ? 'ontrack' : 'fix');
        const chip = G4_CHIP[status];
        const unitText = displayUnit ? (displayUnit === 'WPM' ? ' wpm' : displayUnit) : '';
        const sentence = evidenceMissing
            ? 'A couple more sessions and we can read this.'
            : status === 'ontrack'
                ? `${interpretation.label} — leave this alone.`
                : `${interpretation.label}${microcopy ? ` — ${microcopy}` : ''}`;
        return (
            <Card className={`rounded-xl p-5 ${className}`} data-testid={resolvedTestId}>
                <div className="flex items-start justify-between gap-2">
                    <p className="text-[12px] font-extrabold uppercase tracking-wide text-[#414b5c]">{label}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${chip.cls}`} data-testid={`${resolvedTestId}-chip`}>{chip.text}</span>
                </div>
                <p className={`mt-3 text-[34px] font-extrabold leading-none ${G4_NUM_COLOR[status]}`} data-testid={`${resolvedTestId}-interpretation`}>
                    {evidenceMissing ? '—' : <>{displayValue}<span className="ml-1 text-[14px] font-bold text-foreground/55">{unitText}</span></>}
                </p>
                <p className="mt-2 text-[13px] leading-snug text-[#414b5c]" data-testid={`${resolvedTestId}-detail`}>{sentence}</p>
            </Card>
        );
    }

    return (
    <Card className={`rounded-xl p-6 ${className}`} data-testid={resolvedTestId}>
        <div className="flex items-center justify-between mb-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${label.includes('Filler') ? 'bg-accent/10 text-accent' : 'bg-primary/10 text-primary'}`}>
                {/* Clone icon to enforce size and styling if needed, but usually props are fine. Wrapper handles color. */}
                {React.cloneElement(icon as React.ReactElement, { size: 24, className: "stroke-current" })}
            </div>
        </div>
        <div>
            <div className="flex items-baseline gap-1">
                <span
                    className={evidenceMissing
                        ? 'text-lg font-semibold text-foreground/55 tracking-tight'
                        : 'text-3xl font-bold text-foreground tracking-tight'}
                    data-evidence={evidenceMissing ? 'missing' : 'present'}
                >
                    {displayValue}
                </span>
                {displayUnit && <span className="ml-1 text-sm font-semibold text-foreground/70">{displayUnit}</span>}
            </div>
            <p className="mt-1 text-sm font-semibold text-foreground/75">{label}</p>
            {description && (
                <p className="mt-3 text-xs font-medium leading-snug text-foreground/70" data-testid={`${resolvedTestId}-explanation`}>
                    {description}
                </p>
            )}
        </div>
    </Card>
    );
};

const SessionHistoryItem: React.FC<SessionHistoryItemProps> = ({ session, sessionHistory, isPro: _isPro, isSelected, onToggleSelect, profileName }) => {
    const metrics = getSessionAnalysisMetrics(session);
    const durationMins = Math.floor(session.duration / 60);
    const durationSecs = session.duration % 60;
    const durationStr = `${durationMins}:${durationSecs.toString().padStart(2, '0')}`;

    // #1047 PR-U1: transcript-derived metrics show only when transcript-state provenance allows it — a
    // not_captured row's sentinel 0/{} is never rendered as a measurement (shown as N/A).
    const transcriptStateItem = presentTranscript(session.transcript_state, session.transcript).state;
    const wpm = transcriptDerivedMetricShowable(transcriptStateItem, typeof session.wpm === 'number') ? metrics.wpm : 'N/A';
    const clarity = transcriptDerivedMetricShowable(transcriptStateItem, typeof session.clarity_score === 'number') ? metrics.clarityScore : 'N/A';
    const totalFillers = transcriptDerivedMetricShowable(transcriptStateItem, isUsableFillerCounts(session.filler_words)) ? metrics.fillerCount : 'N/A';

    return (
        <div
            className="group mb-3 flex flex-col items-stretch justify-between rounded-xl border border-[hsl(var(--border))] bg-muted p-4 transition-colors last:mb-0 hover:border-[hsl(var(--border-strong))] hover:bg-white surface-shadow md:flex-row md:items-center"
            data-testid={`${TEST_IDS.SESSION_HISTORY_ITEM}-${session.id}`}
        >
            <div className="mb-4 flex min-w-0 w-full items-center gap-4 md:mb-0 md:w-auto">
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
                    className="flex min-w-0 flex-1 items-center gap-4 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    <div className="w-12 h-12 bg-secondary/20 rounded-xl flex items-center justify-center shrink-0">
                        <Mic className="w-6 h-6 text-secondary" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            {/* #G4 chunk 3: per-row engine/PRIVATE badge removed — the section footer already
                                makes the privacy promise ("Private to you…"), so the per-row pill was
                                redundant clutter. Recording mode remains available on the session detail view. */}
                            <p className="max-w-full truncate text-base font-semibold text-foreground md:max-w-[200px]">{session.title || 'Practice Session'}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground/70">
                            <Clock className="w-3 h-3" />
                            <span>{durationStr} duration</span>
                            <span className="text-foreground/50">•</span>
                            <span>{formatDateTime(session.created_at)}</span>
                        </div>
                    </div>
                </NavLink>
            </div>

            <div className="grid w-full grid-cols-3 items-start gap-2 px-0 sm:px-4 md:flex md:w-auto md:items-center md:justify-end md:gap-8 md:px-0">
                <div className="min-w-0 text-center">
                    <p className="font-bold text-foreground text-lg">{wpm}{typeof wpm === 'number' && <span className="ml-0.5 text-xs font-normal text-foreground/60">WPM</span>}</p>
                    <p className="text-xs font-bold uppercase tracking-wider text-foreground/70">Speaking Pace</p>
                </div>
                <div className="min-w-0 text-center">
                    <p className={`font-bold text-lg ${typeof totalFillers === 'number' && totalFillers <= 3 ? "text-success" : "text-primary"}`}>
                        {totalFillers}
                    </p>
                    <p className="text-xs font-bold uppercase tracking-wider text-foreground/70">Detected filler words</p>
                </div>
                <div className="min-w-0 text-center">
                    <p className="font-bold text-primary text-lg">{typeof clarity === 'number' ? `${clarity.toFixed(0)}%` : clarity}</p>
                    <p className="text-xs font-bold uppercase tracking-wider text-foreground/70">Clear Delivery</p>
                </div>

                {/* #G4 chunk 3: Open (outlined) + PDF (teal-filled) button pair — the PDF is the emphasised
                    action while it's still downloadable within the 2-session retention window. */}
                <div className="hidden items-center gap-2 border-l border-border pl-4 md:flex" data-testid={`download-pdf-container-${session.id}`}>
                    <NavLink
                        to={`/analytics/${session.id}`}
                        className="inline-flex items-center justify-center gap-2 rounded-[9px] border border-[#b8d9d5] bg-white px-[14px] py-[9px] text-[13px] font-bold text-[#0d7d74] transition-colors hover:bg-[#f0f9f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label="Open saved session details"
                        data-testid={`open-session-detail-${session.id}`}
                    >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                        Open
                    </NavLink>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void generateSessionPdf(session, profileName, _isPro, sessionHistory);
                        }}
                        title="Download Session PDF"
                        data-testid={`download-pdf-btn-${session.id}`}
                        className="inline-flex items-center justify-center gap-2 rounded-[9px] bg-[#0d7d74] px-[14px] py-[9px] text-[13px] font-bold text-white transition-colors hover:bg-[#0b6a62] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                        <Download className="h-4 w-4" aria-hidden="true" />
                        PDF
                    </button>
                </div>
            </div>
            <div className="w-full flex justify-end md:hidden pt-4 border-t border-border mt-4" data-testid={`download-pdf-container-mobile-${session.id}`}>
                <div className="flex w-full flex-col gap-2">
                    <NavLink
                        to={`/analytics/${session.id}`}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-[9px] border border-[#b8d9d5] bg-white px-[14px] py-[9px] text-[13px] font-bold text-[#0d7d74] transition-colors hover:bg-[#f0f9f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label="Open saved session details"
                        data-testid={`open-session-detail-mobile-${session.id}`}
                    >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                        Open Saved Session
                    </NavLink>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void generateSessionPdf(session, profileName, _isPro, sessionHistory);
                        }}
                        data-testid={`download-pdf-btn-mobile-${session.id}`}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-[9px] bg-[#0d7d74] px-[14px] py-[9px] text-[13px] font-bold text-white transition-colors hover:bg-[#0b6a62] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                        <Download className="h-4 w-4" aria-hidden="true" /> Download Session PDF
                    </button>
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
    // Readability/future-proofing only (selectedSessions is capped at 2): O(1) membership lookup in
    // the session-history render below. Not a performance change.
    const selectedSessionIds = useMemo(() => new Set(selectedSessions), [selectedSessions]);
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

    // #G4 §3: the analysis carousel is retired in favor of a stacked layout — every selected tool is
    // rendered in order (no embla API, no active-slide gating, no indicator dots).

    // Optimization: Memoize filtered analysis slides for O(1) lookup in render path
    const displayedAnalysisSlides = useMemo(() => {
        const optionsById = new Map(ANALYSIS_SLIDE_OPTIONS.map(option => [option.id, option]));
        return (isCustomFocus ? customAnalysisSlides : selectedToolGroup.analysisSlideIds)
            .map(id => optionsById.get(id))
            .filter((option): option is AnalysisSlideConfig => Boolean(option));
    }, [customAnalysisSlides, isCustomFocus, selectedToolGroup]);

    const focusLabel = isCustomFocus ? 'Custom' : selectedToolGroup.label;
    const focusPurpose = isCustomFocus
        ? 'Inspect specific metrics when you already know the signal you want to measure.'
        : selectedToolGroup.purpose;

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
            // #1047: comparison metrics are transcript-derived — gate each on transcript-state provenance so a
            // not_captured/expired session compares as N/A (null), never as a sentinel 0.
            const state = presentTranscript(s!.transcript_state, s!.transcript).state;
            const clarityShowable = metrics.isClarityScorable && transcriptDerivedMetricShowable(state, typeof s!.clarity_score === 'number');
            return {
                id: s!.id,
                created_at: s!.created_at,
                wpm: transcriptDerivedMetricShowable(state, typeof s!.wpm === 'number') ? metrics.wpm : null,
                clarity_score: clarityShowable ? metrics.clarityScore : null,
                filler_count: transcriptDerivedMetricShowable(state, isUsableFillerCounts(s!.filler_words)) ? metrics.fillerCount : null,
                duration_seconds: s!.duration,
            };
        }) as [{ id: string; created_at: string; wpm: number | null; clarity_score: number | null; filler_count: number | null; duration_seconds: number }, { id: string; created_at: string; wpm: number | null; clarity_score: number | null; filler_count: number | null; duration_seconds: number }];
    }, [selectedSessions, sessionHistory]);

    const trendData = useMemo(() => {
        if (!sessionHistory || sessionHistory.length < 2) return [];
        return sessionHistory.slice(0, 10).reverse().map(s => {
            const metrics = getSessionAnalysisMetrics(s);
            // #1047: gate EVERY transcript-derived trend point on transcript-state provenance, not numeric
            // presence — a not_captured/expired session's sentinel 0/{} must never chart as a real point.
            // null = omitted point (Recharts renders a gap). Pauses are timing-derived (not transcript) and
            // are charted as before.
            const state = presentTranscript(s.transcript_state, s.transcript).state;
            const wpmShowable = transcriptDerivedMetricShowable(state, typeof s.wpm === 'number');
            const fillerShowable = transcriptDerivedMetricShowable(state, isUsableFillerCounts(s.filler_words));
            const clarityShowable = metrics.isClarityScorable && transcriptDerivedMetricShowable(state, typeof s.clarity_score === 'number');
            return {
                date: formatDate(s.created_at),
                wpm: wpmShowable ? metrics.wpm : null,
                clarity: clarityShowable ? metrics.clarityScore : null,
                fillers: fillerShowable ? metrics.fillerCount : null,
                pauses: Number(calculateRatePerMinute(getSessionPauseCount(s), s.duration || 0, 1)),
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
    // Transcript-quality caveat for the saved session keeps weak evidence visibly directional rather
    // than presenting it as precise measurement authority.
    const targetSessionQuality = useMemo(
        () => targetSession
            ? getTranscriptQualityCaveat(targetSession.transcript ?? '', targetSession.engine ?? undefined)
            : null,
        [targetSession]
    );
    // #1047 PR-U1: one server-owned transcript-state decision — surfaces never infer state from an empty
    // string. Drives the honest transcript body + AI/text-action availability below.
    const targetTranscript = useMemo(
        () => targetSession ? presentTranscript(targetSession.transcript_state, targetSession.transcript) : null,
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
                    {/* #1045: the Progress loop — direction + two takeaways + "Practice this next".
                        Renders nothing until an eligible evaluation exists for this session. */}
                    <ProgressPanel session={targetSession} />

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
                        {/* #1047 PR-U1: transcript-derived tiles show only when transcript-state provenance
                            allows it; a not_captured session's sentinel 0/{} renders as Not enough data, an
                            expired session still shows its genuinely persisted measurements. */}
                        <StatCard
                            icon={<Gauge />}
                            label="Speaking Pace"
                            value={transcriptDerivedMetricShowable(targetTranscript?.state, typeof targetSession.wpm === 'number') ? targetSessionMetrics.wpm : NOT_ENOUGH_DATA}
                            unit="WPM"
                            // #1131 round-4 (#1): for an EXPIRED row the transcript is gone but measurements
                            // persist, so the recomputed *Explanation (word/error/filler counts, errorCount=0
                            // from absent text) is potentially FALSE while the persisted value still shows —
                            // withhold it. (not_captured keeps its honest evidence-free "cannot be scored"
                            // explanation; available keeps its transcript-backed narrative.)
                            description={targetTranscript?.state === TRANSCRIPT_STATE.EXPIRED ? undefined : targetSessionMetrics.wpmExplanation}
                            testId={TEST_IDS.STAT_CARD_SPEAKING_PACE}
                        />
                        {/* #1045: one vocabulary for absent evidence. A bare "--" reads as a rendering
                            glitch; "Not enough data" states what is actually true about this session. */}
                        <StatCard
                            icon={<Target />}
                            label="Clear Delivery"
                            value={(targetSessionMetrics.isClarityScorable && transcriptDerivedMetricShowable(targetTranscript?.state, typeof targetSession.clarity_score === 'number')) ? targetSessionMetrics.clarityScore : NOT_ENOUGH_DATA}
                            unit={(targetSessionMetrics.isClarityScorable && transcriptDerivedMetricShowable(targetTranscript?.state, typeof targetSession.clarity_score === 'number')) ? '%' : undefined}
                            // #1131 round-4 (#1): withhold the recomputed clarity narrative ONLY for an EXPIRED
                            // row — the persisted clarity SCORE may still show, but the explanation (recomputed
                            // with errorCount=0 from absent text) would be a false statement. not_captured keeps
                            // its honest "cannot be scored" copy.
                            description={targetTranscript?.state === TRANSCRIPT_STATE.EXPIRED ? undefined : targetSessionMetrics.clarityExplanation}
                            testId={TEST_IDS.CLARITY_SCORE_VALUE}
                        />
                        <StatCard
                            icon={<TrendingUp />}
                            label="Detected filler words"
                            value={transcriptDerivedMetricShowable(targetTranscript?.state, isUsableFillerCounts(targetSession.filler_words)) ? targetSessionMetrics.fillerCount : NOT_ENOUGH_DATA}
                            // #1131 round-4 (#1): same rule for the filler narrative — withhold only for an
                            // EXPIRED row rather than recompute from absent text.
                            description={targetTranscript?.state === TRANSCRIPT_STATE.EXPIRED ? undefined : targetSessionMetrics.fillerExplanation}
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
                                    <span className="uppercase tracking-wider">Recording provenance</span>
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
                                    // #1047 PR-U1: server-owned transcript_state drives this — an unavailable
                                    // transcript shows its honest reason (expired / not captured), never an
                                    // ordinary empty string, and never as if it were a real transcript.
                                    data-session-detail-transcript={targetTranscript?.canRenderTranscript ? (targetSession.transcript ?? "").trim() : ''}
                                    data-transcript-state={targetTranscript?.state}
                                >
                                    {targetTranscript?.canRenderTranscript
                                        ? (targetSession.transcript ?? "").trim()
                                        : targetTranscript?.unavailableMessage}
                                </div>
                            </CardContent>
                        </Card>

                        {/* AI Suggestions Panel */}
                        <div className="h-full">
                            <AISuggestions
                                // #1047 PR-U1: AI/text actions are unavailable unless the transcript is
                                // actually readable — withholding the text disables "Get Suggestions".
                                transcript={targetTranscript?.aiAvailable ? (targetSession.transcript || "") : ""}
                                sessionId={targetSession.id}
                                // A previously persisted valid result remains readable after transcript expiry;
                                // only new generation is disabled when the saved transcript is unavailable.
                                initialSuggestions={targetSession.ai_suggestions ?? undefined}
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
                                    <p className="text-xs font-bold uppercase tracking-wider text-primary">Working on</p>
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
                        </CardHeader>
                    </Card>

                    {/* #G4 §2: the four cards explain their relationship by POSITION, not a sentence. Heading left,
                        the evidence window right. The prior "selected together…" subtitle + focus explanation
                        boxes are deleted (explanation lives behind the focus control / a ? , not as prose). */}
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="space-y-1">
                            <h2 className="text-lg font-semibold text-foreground">{"What that’s based on"}</h2>
                            <p className="text-sm font-medium text-foreground/70">Across your last 6 sessions</p>
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
                                    {STAT_CARD_OPTIONS.map(option => {
                                        const checked = customStatCards.includes(option.id);
                                        return (
                                            <DropdownMenuCheckboxItem
                                                key={option.id}
                                                checked={checked}
                                                onCheckedChange={() => toggleCustomStatCard(option.id)}
                                                disabled={
                                                    (!checked && customStatCards.length >= 4) ||
                                                    (checked && customStatCards.length <= 1)
                                                }
                                            >
                                                {option.label}
                                            </DropdownMenuCheckboxItem>
                                        );
                                    })}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                    </div>

                    {/* #G4 §1 HERO — "Do this next". The single instruction leads (imperative sentence), the
                        quantified evidence sits directly beneath it (numbers bold, inline), and three concrete
                        "what to try" steps sit in the purple insight column. Quantitative drives qualitative. */}
                    {Number(overallStats.totalSessions) > 0 && (() => {
                        const summary = getNarrativeSummary({
                            avgWpm: overallStats.averageWPM,
                            avgPausesPerMin: overallStats.avgPausesPerMin,
                            avgFillerWordsPerMin: overallStats.avgFillerWordsPerMin,
                            avgClarity: overallStats.avgClarity,
                        });
                        const wpm = Math.round(Number(overallStats.averageWPM) || 0);
                        const fillers = Math.round((Number(overallStats.avgFillerWordsPerMin) || 0) * 10) / 10;
                        const clarity = Math.round(Number(overallStats.avgClarity) || 0);
                        const pauses = Math.round((Number(overallStats.avgPausesPerMin) || 0) * 10) / 10;
                        // Per-driver evidence (numbers bold inline) + three physical steps. Falls back to a
                        // maintenance instruction when every signal is on target (summary.driver === null).
                        const detail: { evidence: React.ReactNode; steps: string[] } = (() => {
                            switch (summary.driver) {
                                case 'pace':
                                    return { evidence: <>You&rsquo;re averaging <strong>{wpm} wpm</strong> against your <strong>130&ndash;150</strong> target. {summary.why}</>,
                                        steps: ['Read your opening 20% faster than feels right.', 'Slow down only for the one line you most want remembered.', 'Stop at 60 seconds and check the pace band.'] };
                                case 'filler words':
                                    return { evidence: <>You&rsquo;re at <strong>{fillers}/min</strong> filler words. {summary.why}</>,
                                        steps: ['Swap one filler for a half-second silent pause.', 'Slow the sentence you rush most — fillers cluster there.', 'Re-record the same 30 seconds and count them out loud.'] };
                                case 'pause rhythm':
                                    return { evidence: <>Your pauses run <strong>{pauses}/min</strong>. {summary.why}</>,
                                        steps: ['Finish the whole phrase before you pause.', 'Take one deliberate breath before the key point.', 'Cut mid-word restarts — pause, then continue.'] };
                                case 'clear delivery':
                                    return { evidence: <>Your clarity is <strong>{clarity}%</strong>. {summary.why}</>,
                                        steps: ['Say the main point first, the context second.', 'One idea per sentence — split the long ones.', 'End each thought on a falling tone, not a trailing one.'] };
                                default:
                                    return { evidence: <>{summary.why}</>,
                                        steps: ['Keep the pace steady.', 'Land the takeaway cleanly.', 'Record another take to hold the trend.'] };
                            }
                        })();
                        return (
                            <div className="rounded-xl border border-[#dbe2ec] border-t-[3px] border-t-[#6d28d9] bg-white p-6 shadow-sm" data-testid="try-this-next">
                                <div className="grid gap-6 md:grid-cols-[1fr_300px] md:items-start">
                                    <div>
                                        <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-[#6d28d9]">◎ Do this next</p>
                                        <p className="mt-2 text-[30px] font-extrabold leading-[1.1] tracking-[-0.02em] text-[#1f2733]" data-testid="try-this-next-action">{summary.action}</p>
                                        <p className="mt-3 text-[16px] leading-relaxed text-[#232c3a]" data-testid="try-this-next-why">{detail.evidence}</p>
                                        <div className="mt-5 flex items-center gap-4">
                                            <a href="/session" className="inline-flex items-center rounded-[10px] bg-[#0d7d74] px-4 py-2.5 text-[15px] font-bold text-white hover:bg-[#0a5f58]" data-testid="hero-practise-now">Practise this now</a>
                                            <details className="text-[13px] font-bold text-[#0d7d74]">
                                                <summary className="cursor-pointer list-none hover:underline" data-testid="hero-method">How we worked this out</summary>
                                                <p className="mt-2 max-w-md text-[13px] font-normal leading-snug text-[#414b5c]">We compare each delivery signal (pace, fillers, clarity, pause rhythm) against its target across your last 6 sessions and surface the one with the largest, most persistent gap — never more than one at a time.</p>
                                            </details>
                                        </div>
                                    </div>
                                    <div className="rounded-lg bg-[#f5f0ff] p-4" data-testid="hero-what-to-try">
                                        <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#5b21b6]">What to try</p>
                                        <ol className="mt-3 space-y-3">
                                            {detail.steps.map((step, i) => (
                                                <li key={i} className="flex gap-2.5 text-[13px] leading-snug text-[#232c3a]">
                                                    <span className="font-extrabold text-[#6d28d9]">{i + 1}</span>
                                                    <span>{step}</span>
                                                </li>
                                            ))}
                                        </ol>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Dynamic Stat Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {displayedStatCards.map(option => (
                            <StatCard
                                key={option.id}
                                icon={option.icon}
                                label={option.label}
                                value={option.getValue(overallStats)}
                                unit={option.unit}
                                microcopy={option.microcopy}
                                interpretation={option.getInterpretation?.(overallStats)}
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
                                    {ANALYSIS_SLIDE_OPTIONS.map(option => {
                                        const checked = customAnalysisSlides.includes(option.id);
                                        return (
                                            <DropdownMenuCheckboxItem
                                                key={option.id}
                                                checked={checked}
                                                onCheckedChange={() => toggleCustomAnalysisSlide(option.id)}
                                                disabled={
                                                    (!checked && customAnalysisSlides.length >= 4) ||
                                                    (checked && customAnalysisSlides.length <= 1)
                                                }
                                            >
                                                {option.label}
                                            </DropdownMenuCheckboxItem>
                                        );
                                    })}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                    </div>

                    {/* #G4 §3: Analysis tools — stacked (carousel retired). Every selected tool renders in full,
                        in order, so nothing hides behind a swipe and each chart is scannable at once. */}
                    <div className="space-y-6">
                        {displayedAnalysisSlides.map((option) => (
                            <div key={option.id}>
                                {option.id === 'pace_trend' && (
                                    <TrendChart
                                        title="Speaking Pace Trend"
                                        description="Track your words per minute over time"
                                        data={trendData}
                                        metric="wpm"
                                    />
                                )}
                                {option.id === 'clarity_trend' && (
                                    <TrendChart
                                        title="Clarity Trend"
                                        description="Monitor your speech clarity percentage"
                                        data={trendData}
                                        metric="clarity"
                                    />
                                )}
                                {option.id === 'pause_trend' && (
                                    <TrendChart
                                        title="Pause Rhythm Trend"
                                        description="Pauses per minute across your sessions"
                                        data={trendData}
                                        metric="pauses"
                                    />
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
                            </div>
                        ))}

                        {/* Session History Section - Moved below carousel */}
                        <div id="session-history-section">
                            <Card className="rounded-xl p-5">
                                {/* #G4 §5: "Recent sessions" — exactly the 2 most recent (the retention window, not a
                                    truncation). Transcripts + audio purge beyond 2 (R1/R2 live in prod), metrics rows
                                    persist permanently — so the "we keep only 2" promise is now honest. */}
                                <div className="mb-4 flex items-start justify-between gap-3">
                                    <div>
                                        <h2 className="text-xl font-bold text-foreground">Recent sessions</h2>
                                        <p className="mt-1 text-sm font-medium text-foreground/70">We only keep the 2 most recent transcripts. Download the PDF while available.</p>
                                    </div>
                                    {selectedSessions.length === 2 && (
                                        <Button
                                            onClick={() => setShowComparison(true)}
                                            className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
                                        >
                                            Compare Selected (2)
                                        </Button>
                                    )}
                                </div>
                                <div className="space-y-3" data-testid={TEST_IDS.SESSION_HISTORY_LIST}>
                                    {sessionHistory && sessionHistory.length > 0 ? (
                                        sessionHistory.slice(0, 2).map((session) => (
                                            <SessionHistoryItem
                                                key={session.id}
                                                session={session}
                                                sessionHistory={sessionHistory}
                                                isPro={isProUser}
                                                isSelected={selectedSessionIds.has(session.id)}
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
                                {sessionHistory && sessionHistory.length > 0 && (
                                    <p className="mt-4 border-t border-[#eef1f6] pt-3 text-xs font-medium text-foreground/60">
                                        Private to you. Transcripts are never stored beyond your two most recent sessions.
                                    </p>
                                )}
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
