import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { getSessionById, resolveTranscriptView } from '@/lib/storage';
import { isValidMetric, formatDurationMinutes, NOT_ENOUGH_DATA } from '@/utils/metricValidity';
import { validateNextActionSignal } from '@/contracts/nextActionSignal';
import { NavLink } from 'react-router-dom';
import { TrendingUp, Clock, Layers, Download, Target, Gauge, BarChart, Settings, Activity, Mic, ChevronDown, AudioLines } from 'lucide-react';
import logger from '../lib/logger';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ProgressPanel } from '@/components/progress/ProgressPanel';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ErrorDisplay } from './ErrorDisplay';
import { generateSessionPdf } from '../lib/pdfGenerator';
import { authEpoch, currentOwnerId } from '@/services/loginSessionLog';
import { GoalsSection } from './analytics/GoalsSection';
import { SessionComparisonDialog } from './analytics/SessionComparisonDialog';
import { TrendsCard } from './analytics/TrendsCard';
import type { TrendDataPoint } from './analytics/trendMetrics';
import { SavedFocusPointsCoverage } from './analytics/SavedFocusPointsCoverage';
import { SavedPracticeLoopReview } from './analytics/SavedPracticeLoopReview';
import { ProgressHeader } from './analytics/ProgressHeader';
import { RuleCard } from './analytics/RuleCard';
import { metricConfig, type TrendMetric } from './analytics/trendMetrics';
import { trackSessionPdfDownloaded, type PdfSurface } from '@/services/reviewSurfaceTelemetry';
import { formatSessionRecordingMode } from '@/utils/engineLabels';
import { getSessionAnalysisMetrics, calculateRatePerMinute, ANALYTICS_THRESHOLDS } from '@/utils/sessionAnalysis';
import { calculateOverallStats, getSessionPauseCount } from '@/lib/analyticsUtils';
import { hasValidPauseEvidence } from '@/utils/metricValidity';
import { PRODUCT_LABEL, mmss, plural, shortDate, shortTime } from '@/lib/displayFormat';
import {
    decodePace,
    decodePauseRhythm,
    decodeFillers,
    decodeClarity,
    fillerRatePhrase,
    FILLER_NOTICEABLE_PER_MIN,
    getNarrativeSummary,
    type CoachingMetric,
} from '@/utils/coachingNarrative';

import type { PracticeSession, SessionProduct } from '@/types/session';
import type { UserProfile } from '@/types/user';
import type { OverallStats } from '@/types/analytics';
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
/**
 * #1258 (PM RETURN, #1535): the success-named `session_pdf_downloaded` is sent only after the PDF was actually handed
 * to the browser to save. A failed generation (already shown as a toast) or a rejection sends nothing.
 *
 * #1258 (RWT run 36955422629): a history-list row is the metrics-only LIST select (#1306 Step 3) and never carries
 * `transcript`, so a PDF built from it could never include the transcript page. A list download therefore reads THIS
 * one session's detail row first — the same single-session read as opening it — and builds the PDF from that. If the
 * detail read fails, the PDF is built from the list row as before (metrics, no transcript page). The detail surface
 * already holds the detail row.
 */
const downloadSessionPdf = (
    surface: PdfSurface, session: PracticeSession, username: string, isPro: boolean, sessionsForDay: PracticeSession[],
): void => {
    // #1573 Codex P1 (review 5460913397; 4223017340): bound to the signed-in owner AND the auth epoch that started it. A
    // sign-out or account switch while the detail/progress reads are in flight moves the epoch and discards the work — no
    // previous-account PDF (transcript or metrics fallback), no success event — even when the sign-in time is unknown.
    // No owner at the start fails closed. Nothing is aborted at the wire (#1422); the late answer is simply not used.
    const startedOwner = currentOwnerId();
    const startedEpoch = authEpoch();
    const stillCurrent = () => startedOwner !== null && authEpoch() === startedEpoch && currentOwnerId() === startedOwner;
    if (!stillCurrent()) return;
    const source = surface === 'session_detail'
        ? Promise.resolve(session)
        : getSessionById(session.id).then((detail) => detail ?? session, () => session);
    void source.then((pdfSession) => {
        const foreignRow = typeof pdfSession.user_id === 'string' && pdfSession.user_id !== startedOwner;
        if (!stillCurrent() || foreignRow) return false;
        return generateSessionPdf(pdfSession, username, isPro, sessionsForDay, stillCurrent);
    }).then(
        (saved) => { if (saved) trackSessionPdfDownloaded(surface); },
        () => undefined,
    );
};

interface AnalyticsDashboardProps {
    profile: UserProfile | null;
    isProUser?: boolean;
    sessionHistory: PracticeSession[];
    overallStats: OverallStats;
    /** #1258 D5: the oldest counted session's `created_at` (null while unknown) — the header's "since {date}". */
    firstSessionAt?: string | null;
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
    interpretation?: CoachingMetric;
    /** Overrides the card's one sentence (see StatCardConfig.getDetail). */
    detail?: string | null;
    /** #1258 D5 (Rev 2 §5.6): the metric's colour dot (from TrendChart's palette) and, for pace, the target. */
    metric?: TrendMetric;
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

// --- Stat Card Configuration ---
// Exhaustive list of all available stat cards for user customization
// Add new stat cards here for future analytics features


/**
 * #1258 D5 (PO 2026-10-07): the newest-sessions window some cards read — the newest 4 sessions, valid measurements
 * only. `stats` is that window's `calculateOverallStats`, `fillersPerSession` the mean measured filler count in it.
 */
type RecentWindow = { sessions: number; stats: OverallStats | null; fillersPerSession: number | null; fillersPerMin: number | null };
const RECENT_WINDOW_SESSIONS = 4;
/** OverallStats averages are `string | number | null` (rates arrive via `toFixed`); a non-finite or absent value is null. */
const numberOrNull = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
};

type StatCardConfig = {
    id: string;
    /** The name in the Custom picker; the card shows `getLabel` when present. */
    label: string;
    getLabel?: (recent: RecentWindow) => string;
    icon: React.ReactNode;
    getValue: (stats: OverallStats, recent: RecentWindow) => string | number | null;
    unit?: string;
    description?: string;
    /** #1258 D5: the metric's colour dot on the card (TrendChart's palette). */
    metric?: TrendMetric;
    // Narrative-first: decode the raw value into a plain label (Fast / Choppy / Strong …).
    getInterpretation?: (stats: OverallStats, recent: RecentWindow) => CoachingMetric;
    /** The card's one sentence when the grade must name the value it judged (fillers: the per-minute rate). */
    getDetail?: (stats: OverallStats, recent: RecentWindow) => string | null;
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
        metric: 'wpm',
        getInterpretation: (stats) => decodePace(stats.averageWPM),
    },
    {
        id: 'filler_words_per_min',
        // #1258 D5 (PO 2026-10-07): a COUNT per session over the newest 4 sessions (measured zeroes in, missing out),
        // replacing the all-session per-minute rate. Decimals are fine for an average.
        label: 'Average fillers per session',
        getLabel: (recent) => `Average fillers per session · last ${plural(recent.sessions, 'session', 'sessions')}`,
        icon: <TrendingUp size={24} className="text-foreground/70" />,
        getValue: (_stats, recent) => recent.fillersPerSession === null ? null : recent.fillersPerSession.toFixed(1),
        description: 'Filler words counted per session, averaged over your newest sessions',
        metric: 'fillers',
        // #1573 Codex P1 4230859591: judged on the SAME true-filler basis and window as the count shown, never the legacy
        // all-keys rate (which still counts default-excluded discourse markers such as "so" and "like").
        getInterpretation: (_stats, recent) => decodeFillers(recent.fillersPerMin),
        // #1573 Codex P1 4232318053 + PO 2026-10-09: the count stays the headline; the grade states the rate it judges, so a
        // short and a long take are graded fairly and the grade never judges a number the user can't see.
        getDetail: (_stats, recent) => recent.fillersPerMin === null ? null
            : `${decodeFillers(recent.fillersPerMin).label} · ${fillerRatePhrase(recent.fillersPerMin)}, target under ${FILLER_NOTICEABLE_PER_MIN}`,
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
        label: 'Clear delivery',
        icon: <Target size={24} className="text-foreground/70" />,
        metric: 'clarity',
        getValue: (stats) => stats.avgClarity,
        unit: '%',
        description: 'Based on pace, fillers, and structure — not transcription accuracy.',
        getInterpretation: (stats) => decodeClarity(stats.avgClarity),
    },
    {
        id: 'pause_rhythm',
        label: 'Pause Rhythm',
        icon: <AudioLines size={24} className="text-foreground/70" />,
        getValue: (stats) => stats.avgPausesPerMin,
        unit: '/min',
        description: 'Pauses per minute. Healthy pauses make key ideas easier to follow.',
        metric: 'pauses',
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
    // #1306: the "STT Engine Quality" / by-engine comparison card is REMOVED. Every customer session uses
    // Private STT (Native is test-only; Browser/Cloud are not entitlements), so there are no customer engines to
    // compare. Engine/model/version provenance is retained for operations + #1304 benchmarking only.
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
        analysisSlideIds: ['clarity_trend', 'filler_words', 'weekly_activity'],
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

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, unit, description, interpretation, detail, metric, className = '', testId }) => {
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
        // #1258 D5 (Rev 2 §5.6): no status chip and no coloured number — the value is plain, the one sentence names the
        // read ("Slow · target 130–150" for pace, the label alone otherwise), and a dot carries the metric's colour.
        const unitText = displayUnit ? (displayUnit === 'WPM' ? ' wpm' : displayUnit) : '';
        const sentence = evidenceMissing
            ? 'A couple more sessions and we can read this.'
            : detail
                ?? (metric === 'wpm'
                    ? `${interpretation.label} · target ${ANALYTICS_THRESHOLDS.TARGET_WPM_MIN}–${ANALYTICS_THRESHOLDS.TARGET_WPM_MAX}`
                    : interpretation.label);
        return (
            <Card className={`rounded-xl p-5 ${className}`} data-testid={resolvedTestId} data-status={evidenceMissing ? 'nodata' : interpretation.tone}>
                <div className="flex items-start gap-2">
                    {metric && <span aria-hidden className="mt-[3px] h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: metricConfig[metric].color }} data-testid={`${resolvedTestId}-dot`} />}
                    <p className="text-[12px] font-extrabold uppercase tracking-wide text-neutral-secondary">{label}</p>
                </div>
                <p className="mt-3 text-[34px] font-extrabold leading-none text-neutral-heading" data-testid={`${resolvedTestId}-interpretation`}>
                    {evidenceMissing ? '—' : <>{displayValue}<span className="ml-1 text-[14px] font-bold text-neutral-secondary">{unitText}</span></>}
                </p>
                <p className="mt-2 text-[13px] leading-snug text-neutral-secondary" data-testid={`${resolvedTestId}-detail`}>{sentence}</p>
            </Card>
        );
    }

    return (
    <Card className={`rounded-xl p-6 ${className}`} data-testid={resolvedTestId}>
        <div className="flex items-center justify-between mb-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${label.includes('Filler') ? 'bg-signature-ground text-signature-text' : 'bg-primary/10 text-signature-text'}`}>
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

/** #1258 D9 (Rev 2 §5.9): the product pill on a Recent sessions row. Only the persisted product is shown — never inferred. */
const ProductTag: React.FC<{ product: SessionProduct }> = ({ product }) => (
    <span
        className={`rounded-full border px-[9px] py-[3px] text-[11px] font-extrabold uppercase tracking-[0.06em] ${product === 'focus_points'
            ? 'border-focus-points-border bg-focus-points-ground text-focus-points'
            : 'border-signature-border bg-signature-ground text-ink'}`}
        data-testid="session-product-tag"
    >
        {PRODUCT_LABEL[product]}
    </span>
);

/** Label left, value right in one fixed column so the same metric lines up row to row (Rev 2 §0.2b/§0.2c). */
const RowMetric: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
    <span className="flex justify-between gap-2.5 whitespace-nowrap">
        <span>{k}</span>
        <strong className="text-right font-extrabold text-neutral-heading">{v}</strong>
    </span>
);

const SessionHistoryItem: React.FC<SessionHistoryItemProps> = ({ session, sessionHistory, isPro: _isPro, isSelected, onToggleSelect, profileName }) => {
    const metrics = getSessionAnalysisMetrics(session);
    // #1306 metrics-only: a metric shows iff its value is persisted (metric-presence provenance).
    const wpm = typeof session.wpm === 'number' ? metrics.wpm : null;
    const clarity = typeof session.clarity_score === 'number' ? metrics.clarityScore : null;
    const product = session.product ?? null;
    const when = `${shortDate(session.created_at)}, ${shortTime(session.created_at)}`;

    return (
        <div className="flex flex-col gap-1.5 px-5 py-4 hover:bg-neutral-band" data-testid={`${TEST_IDS.SESSION_HISTORY_ITEM}-${session.id}`}>
            <div className="flex flex-wrap items-center gap-3">
                {product && <ProductTag product={product} />}
                <NavLink
                    to={`/analytics/${session.id}`}
                    data-testid={`session-detail-link-${session.id}`}
                    className="rounded-sm text-[15px] font-extrabold text-neutral-heading underline decoration-neutral-border-strong underline-offset-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    {when}
                </NavLink>
                <span className="ml-auto text-[14px] font-bold tabular-nums text-neutral-secondary">{mmss(session.duration)}</span>
                <label className="inline-flex min-h-11 items-center gap-2 text-[13px] font-bold text-neutral-secondary">
                    Compare
                    <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onToggleSelect(session.id)}
                        aria-label={`Compare ${product ? PRODUCT_LABEL[product] : 'session'}, ${when}`}
                    />
                </label>
                <div className="flex items-center gap-3" data-testid={`download-pdf-container-${session.id}`}>
                    <NavLink
                        to={`/analytics/${session.id}`}
                        data-testid={`open-session-detail-${session.id}`}
                        aria-label={`Open ${product ? PRODUCT_LABEL[product] : 'session'}, ${when}`}
                        className="inline-flex h-9 items-center rounded-lg bg-ink px-4 text-[14px] font-extrabold text-white hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature focus-visible:ring-offset-2"
                    >
                        Open
                    </NavLink>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            downloadSessionPdf('history_list', session, profileName, _isPro, sessionHistory);
                        }}
                        title="Download Session PDF"
                        data-testid={`download-pdf-btn-${session.id}`}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-signature px-3.5 text-[14px] font-extrabold text-ink hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                        <Download className="h-4 w-4" aria-hidden="true" />PDF
                    </button>
                </div>
            </div>
            <div className="grid grid-cols-1 gap-x-7 text-[14px] font-semibold tabular-nums text-neutral-secondary min-[480px]:grid-cols-[repeat(3,minmax(0,190px))]">
                <RowMetric k="Pace (wpm)" v={wpm ?? '—'} />
                <RowMetric k="Fillers" v={metrics.fillerCount ?? '—'} />
                <RowMetric k="Clear delivery (%)" v={clarity === null ? '—' : clarity.toFixed(0)} />
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
    firstSessionAt = null,
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
            const clarityShowable = metrics.isClarityScorable && typeof s!.clarity_score === 'number';
            return {
                id: s!.id,
                created_at: s!.created_at,
                wpm: typeof s!.wpm === 'number' ? metrics.wpm : null,
                clarity_score: clarityShowable ? metrics.clarityScore : null,
                filler_count: metrics.fillerCount,
                duration_seconds: s!.duration,
            };
        }) as [{ id: string; created_at: string; wpm: number | null; clarity_score: number | null; filler_count: number | null; duration_seconds: number }, { id: string; created_at: string; wpm: number | null; clarity_score: number | null; filler_count: number | null; duration_seconds: number }];
    }, [selectedSessions, sessionHistory]);

    const trendData = useMemo((): TrendDataPoint[] => {
        if (!sessionHistory || sessionHistory.length === 0) return [];
        let previousDay = '';
        return sessionHistory.slice(0, 10).reverse().map((s, i) => {
            const metrics = getSessionAnalysisMetrics(s);
            // #1047: gate EVERY transcript-derived trend point on transcript-state provenance, not numeric
            // presence — a not_captured/expired session's sentinel 0/{} must never chart as a real point.
            // null = omitted point (Recharts renders a gap).
            const wpmShowable = typeof s.wpm === 'number';
            const fillerShowable = metrics.fillerCount !== null;
            const clarityShowable = metrics.isClarityScorable && typeof s.clarity_score === 'number';
            // #1258 D8: one date label per calendar day (the first session of that day).
            const day = shortDate(s.created_at);
            const dayLabel = day !== previousDay ? day : '';
            previousDay = day;
            return {
                i,
                dayLabel,
                createdAt: s.created_at,
                product: s.product ?? null,
                wpm: wpmShowable ? metrics.wpm : null,
                clarity: clarityShowable ? metrics.clarityScore : null,
                fillers: fillerShowable ? metrics.fillerCount : null,
                // #1258 D8: a session without valid pause evidence is LEFT OUT (null), never plotted as 0 — the
                // cause of the flat 0/min line. Same validator the Pause rhythm aggregate uses.
                pauses: hasValidPauseEvidence(s.pause_metrics)
                    ? Number(calculateRatePerMinute(getSessionPauseCount(s), s.duration || 0, 1))
                    : null,
            };
        });
    }, [sessionHistory]);

    // #1258 D5 (PO 2026-10-07): the rule card and the filler card read the NEWEST 4 sessions, equally weighted.
    // `calculateOverallStats` already counts each metric only over sessions that measured it (a measured zero counts,
    // missing data doesn't); the filler average is the mean of the window's measured filler counts.
    const recent = useMemo((): RecentWindow => {
        const windowed = (sessionHistory ?? []).slice(0, RECENT_WINDOW_SESSIONS);
        if (windowed.length === 0) return { sessions: 0, stats: null, fillersPerSession: null, fillersPerMin: null };
        const measured = windowed
            .map((s) => ({ count: getSessionAnalysisMetrics(s).fillerCount, seconds: s.duration ?? 0 }))
            .filter((m): m is { count: number; seconds: number } => m.count !== null);
        const counts = measured.map((m) => m.count);
        // #1573 Codex P1 4230859591: the per-minute rate behind the filler judgment and the rule-card driver is pooled over
        // the same measured true-filler counts the card averages (same rate basis as calculateOverallStats).
        const fillerSeconds = measured.reduce((a, m) => a + (m.seconds > 0 ? m.seconds : 0), 0);
        const fillerTotal = measured.reduce((a, m) => a + (m.seconds > 0 ? m.count : 0), 0);
        return {
            sessions: windowed.length,
            stats: calculateOverallStats(windowed) as OverallStats,
            fillersPerSession: counts.length > 0 ? counts.reduce((a, b) => a + b, 0) / counts.length : null,
            fillersPerMin: fillerSeconds > 0 ? Number(calculateRatePerMinute(fillerTotal, fillerSeconds, 1)) : null,
        };
    }, [sessionHistory]);
    const recentSummary = useMemo(() => recent.stats ? getNarrativeSummary({
        avgWpm: recent.stats.averageWPM,
        avgPausesPerMin: recent.stats.avgPausesPerMin,
        avgFillerWordsPerMin: recent.fillersPerMin,
        avgClarity: recent.stats.avgClarity,
    }) : null, [recent]);

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
    // #1306: a COMPLETED session must carry exactly one valid next-action signal. The saved review now owns the
    // page's next action (#1258 G20), so the signal's generic copy is no longer shown; a missing or invalid signal on a
    // completed session stays a visible data-integrity error (PM 2026-09-25).
    const targetMissingNextAction = useMemo(() => {
        if (!targetSession || targetSession.status !== 'completed') return false;
        return !validateNextActionSignal(targetSession.next_action_signal).ok;
    }, [targetSession]);
    // #1258 G20: the saved session's date ("24 Sep"; the product is appended by the review header). NO ordinal on the
    // detail route (#1535 Codex P2 r4112111970): `useAnalytics` passes only the opened session there, so a position in
    // "this account's history" cannot be known — every detail would read "Session 1". Nothing shown beats a wrong number.
    const targetSessionLabel = useMemo(() => {
        if (!targetSession) return null;
        const created = new Date(targetSession.created_at);
        // G20's short date ("24 Sep"): the header must fit a 320px phone beside its eyebrow.
        return Number.isNaN(created.getTime()) ? null : created.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }, [targetSession]);

    // #1258 D5 (Rev 2 §5.2): the existing focus menu, unchanged inside, restyled as an outline control on the ink header.
    const focusControl = (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className="inline-flex h-10 items-center gap-2 self-start rounded-lg border border-ink-muted px-3.5 text-[14px] font-bold text-white hover:bg-ink-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature"
                    data-testid={TEST_IDS.ANALYTICS_FOCUS_TRIGGER}
                >
                    Choose focus
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </button>
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
    );
    const newestSession = !sessionId && sessionHistory && sessionHistory.length > 0 ? sessionHistory[0] : null;

    return (
        <div className="space-y-6" data-testid={TEST_IDS.ANALYTICS_DASHBOARD}>
            {/* #1258 D5: on the overview the ink header leads every state and owns the page h1. */}
            {!sessionId && (
                <ProgressHeader
                    sessionCount={Number(overallStats.totalSessions) || 0}
                    firstSessionAt={firstSessionAt}
                    latest={newestSession ? { product: newestSession.product ?? null, createdAt: newestSession.created_at } : null}
                    focusLabel={focusLabel}
                    focusControl={newestSession ? focusControl : null}
                />
            )}
            {loading ? (
                <AnalyticsDashboardSkeleton />
            ) : error ? (
                <ErrorDisplay error={error} />
            ) : targetSession && targetSessionMetrics ? (
                /* Session Detail View */
                <div className="space-y-6">
                    {/* #1258 G20 (Where A): the session's saved review is the FIRST block, and owns the ONE next action. */}
                    <SavedPracticeLoopReview sessionId={targetSession.id} sessionLabel={targetSessionLabel} />
                    {/* #1045: the Progress loop keeps its metrics and evidence; its competing "Practice this next"
                        sentence and button give way to the review's single action (PM 2026-09-25). */}
                    <ProgressPanel session={targetSession} nextActionOwnedByReview />

                    {/* #1306 metrics-only: no transcript is stored, so there is no transcript-quality caveat. */}

                    {/* Session Metrics Summary */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {/* #1047 PR-U1: transcript-derived tiles show only when transcript-state provenance
                            allows it; a not_captured session's sentinel 0/{} renders as Not enough data, an
                            expired session still shows its genuinely persisted measurements. */}
                        <StatCard
                            icon={<Gauge />}
                            label="Speaking Pace"
                            value={typeof targetSession.wpm === 'number' ? targetSessionMetrics.wpm : NOT_ENOUGH_DATA}
                            unit="WPM"
                            // #1131 round-4 (#1): for an EXPIRED row the transcript is gone but measurements
                            // persist, so the recomputed *Explanation (word/error/filler counts, errorCount=0
                            // from absent text) is potentially FALSE while the persisted value still shows —
                            // withhold it. (not_captured keeps its honest evidence-free "cannot be scored"
                            // explanation; available keeps its transcript-backed narrative.)
                            description={targetSessionMetrics.wpmExplanation}
                            testId={TEST_IDS.STAT_CARD_SPEAKING_PACE}
                        />
                        {/* #1045: one vocabulary for absent evidence. A bare "--" reads as a rendering
                            glitch; "Not enough data" states what is actually true about this session. */}
                        <StatCard
                            icon={<Target />}
                            label="Clear Delivery"
                            value={(targetSessionMetrics.isClarityScorable && typeof targetSession.clarity_score === 'number') ? targetSessionMetrics.clarityScore : NOT_ENOUGH_DATA}
                            unit={(targetSessionMetrics.isClarityScorable && typeof targetSession.clarity_score === 'number') ? '%' : undefined}
                            // #1131 round-4 (#1): withhold the recomputed clarity narrative ONLY for an EXPIRED
                            // row — the persisted clarity SCORE may still show, but the explanation (recomputed
                            // with errorCount=0 from absent text) would be a false statement. not_captured keeps
                            // its honest "cannot be scored" copy.
                            description={targetSessionMetrics.clarityExplanation}
                            testId={TEST_IDS.CLARITY_SCORE_VALUE}
                        />
                        <StatCard
                            icon={<TrendingUp />}
                            label="Detected filler words"
                            value={targetSessionMetrics.fillerCount === null ? NOT_ENOUGH_DATA : targetSessionMetrics.fillerCount}
                            // #1131 round-4 (#1): same rule for the filler narrative — withhold only for an
                            // EXPIRED row rather than recompute from absent text.
                            description={targetSessionMetrics.fillerExplanation}
                            testId={TEST_IDS.FILLER_COUNT_VALUE}
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Transcript Panel */}
                        <Card className="lg:col-span-2">
                            <CardHeader className="flex flex-row items-center justify-between">
                                <CardTitle className="flex items-center gap-2">
                                    <Mic className="h-5 w-5 text-signature-text" />
                                    Transcript
                                </CardTitle>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => { downloadSessionPdf('session_detail', targetSession, profile?.email || 'User', isProUser, sessionHistory); }}
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
                                {targetMissingNextAction && (
                                    // #1306: never a friendly empty state — a completed session without its next action is a
                                    // data-integrity failure, and it stays visible beside the saved review.
                                    <div className="p-4 rounded-lg border border-[hsl(var(--border))] text-destructive font-medium text-sm" data-testid="session-next-action-integrity-error" role="alert">
                                        Data integrity error: this completed session is missing its next action.
                                    </div>
                                )}
                                {/* #1306 Step 3: the retained transcript. Rendering is gated on the SERVER's
                                    transcript_state via resolveTranscriptView — never on whether text happens
                                    to be present, which would make "expired" and "failed to load" identical
                                    and would render stale text carried by a malformed response. */}
                                {(() => {
                                    const view = resolveTranscriptView(targetSession);
                                    if (view.kind === 'available') {
                                        return (
                                            <div className="mt-4 p-4 bg-muted rounded-lg border border-[hsl(var(--border))] text-sm leading-relaxed whitespace-pre-wrap"
                                                 data-testid="session-detail-transcript">
                                                {view.text}
                                            </div>
                                        );
                                    }
                                    const COPY: Record<'expired' | 'not_captured' | 'unavailable', string> = {
                                        // Position-neutral wording: the metrics are not necessarily "below" this
                                        // panel on every viewport or in every future layout.
                                        expired: 'This transcript is no longer available; session metrics are unaffected.',
                                        not_captured: 'No transcript was captured for this session. Session metrics are unaffected.',
                                        unavailable: 'This transcript could not be loaded. Session metrics are unaffected.',
                                    };
                                    const copy = COPY[view.kind];
                                    return (
                                        <div className="mt-4 p-4 bg-muted/50 rounded-lg border border-dashed border-[hsl(var(--border))] text-sm text-muted-foreground"
                                             data-testid={`session-detail-transcript-${view.kind}`}>
                                            {copy}
                                        </div>
                                    );
                                })()}
                                {/* #1258 / #1407: the saved Focus Points result, read-only; nothing for Open Mic. */}
                                <SavedFocusPointsCoverage sessionId={targetSession.id} />
                            </CardContent>
                        </Card>
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
                    icon={<BarChart className="w-10 h-10 text-signature-text" />}
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


                    {/* #1258 D5: Your latest review — the newest session's SAVED pair, read-only; nothing when none was saved. */}
                    {newestSession && (
                        <SavedPracticeLoopReview
                            sessionId={newestSession.id}
                            sessionLabel={`${shortDate(newestSession.created_at)}, ${shortTime(newestSession.created_at)}`}
                            eyebrow="Your latest review"
                            footerLink={{ to: `/analytics/${newestSession.id}`, label: 'Open this session' }}
                            onlyWhenSaved
                        />
                    )}

                    {/* The Custom focus keeps its stat-card picker (the "What that's based on" heading is retired). */}
                    <div className="flex justify-end empty:hidden">
                        {isCustomFocus && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm" className="gap-2 hover:bg-primary/10 hover:text-signature-text">
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

                    {/* #1258 D5 (Rev 2 §5.5): the rule card — one data statement from the newest 4 sessions (PO 2026-10-07)
                        and one practice action; it replaces the "Do this next" hero. Not rendered below 2 sessions. */}
                    <RuleCard
                        sessionsUsed={recent.sessions}
                        driver={recentSummary?.driver ?? null}
                        wpm={numberOrNull(recent.stats?.averageWPM)}
                        fillersPerSession={recent.fillersPerSession}
                        fillersPerMin={recent.fillersPerMin}
                        clarity={numberOrNull(recent.stats?.avgClarity)}
                        pausesPerMin={numberOrNull(recent.stats?.avgPausesPerMin)}
                    />

                    {/* Dynamic Stat Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {displayedStatCards.map(option => (
                            <StatCard
                                key={option.id}
                                icon={option.icon}
                                label={option.getLabel?.(recent) ?? option.label}
                                value={option.getValue(overallStats, recent)}
                                unit={option.unit}
                                interpretation={option.getInterpretation?.(overallStats, recent)}
                                detail={option.getDetail?.(overallStats, recent)}
                                metric={option.metric}
                                testId={`stat-card-${option.id}`}
                            />
                        ))}
                    </div>

                    {/* #1258 D7: Trends — one card, every row collapsed on mount; the selected focus picks the rows. The custom
                        focus keeps its analysis-tool picker beside the heading. */}
                    <div className="space-y-6">
                        <TrendsCard
                            slideIds={displayedAnalysisSlides.map(option => option.id)}
                            trendData={trendData}
                            sessions={sessionHistory ?? []}
                            headerAction={isCustomFocus ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="sm" className="gap-2 hover:bg-primary/10 hover:text-signature-text">
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
                            ) : undefined}
                        />

                        {/* Session History Section - Moved below carousel */}
                        <div id="session-history-section">
                            {/* #G4 §5: "Recent sessions" — exactly the 2 most recent (the retention window, not a
                                truncation). #1258 D9: one white card, rows divided by a hairline. */}
                            <div className="mb-3 flex items-start justify-between gap-3">
                                <h2 className="text-[20px] font-extrabold text-neutral-heading">Recent sessions</h2>
                                {selectedSessions.length === 2 && (
                                    <Button
                                        onClick={() => setShowComparison(true)}
                                        className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
                                    >
                                        Compare Selected (2)
                                    </Button>
                                )}
                            </div>
                            <div className="divide-y divide-neutral-border-soft overflow-hidden rounded-[14px] border border-neutral-border-strong bg-white" data-testid={TEST_IDS.SESSION_HISTORY_LIST}>
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
                                    <div className="py-12 text-center font-semibold text-neutral-secondary">
                                        <p>No sessions recorded yet.</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* #1258 D5 (Rev 2 §5.3): goals follow Recent sessions, unchanged. */}
                        <GoalsSection />
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
