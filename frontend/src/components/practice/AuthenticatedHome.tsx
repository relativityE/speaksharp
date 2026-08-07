/**
 * #1047 — the authenticated Home surface, below the nav bar.
 *
 * WHY this page looks like this
 * ----------------------------
 * The previous authenticated Home repeated the marketing pitch: a peach hero band, the "Private
 * Practice. Public Impact!" tagline, a "Ready for your next practice?" status card, and two product
 * cards carrying ~60 words of bullet copy each. All of that argues that the product is worth using —
 * to a user who has already signed up and is standing at the door. It made the door harder to find.
 *
 * This surface answers exactly two questions and nothing else:
 *   1. "What would you like to do?"  → the H1 IS the question; the two cards are the two answers.
 *   2. "What should I expect from it?" → three OUTCOME TILES per card: the artifacts a session
 *      produces, as a large value + a one-or-two-word label. Not promises, not adjectives.
 * A user should be able to choose by scanning the two colour blocks (teal = Freeform, violet =
 * Objective), which is why each card's TITLE lives inside its coloured header band and not in the
 * white body.
 *
 * WHY there are em-dashes
 * -----------------------
 * A number on this page is a claim about the user's own speaking. Home has no truthful source for a
 * last-session filler count, and it deliberately does NOT compute its own "vs. last time" comparison
 * (that belongs to the Progress formula work, which has not shipped). Rather than print a plausible
 * `12` or a fabricated `+8%`, an unavailable tile renders an em-dash under its real label: the row
 * keeps its shape, the label still tells the user what a session produces, and nothing false is
 * asserted. Missing evidence NEVER degrades to `0` — a zero is indistinguishable from a real zero.
 * Validity is decided by the shared #1091 layer (`@/utils/metricValidity`), never ad hoc here.
 *
 * Objective is unavailable, so every Objective tile is an em-dash or a capability label. It shows nothing
 * that could be mistaken for the user's personalised results, and its CTA activates nothing.
 */

import * as React from 'react';
import {
    ArrowRight, AlertCircle, BarChart3, FileText, MessageSquare, Music, Sparkles, TrendingUp,
    Check, Target, Repeat, type LucideIcon,
} from 'lucide-react';
import { NOT_ENOUGH_DATA, NOT_ENOUGH_DATA_COMPACT } from '@/utils/metricValidity';
import { lastSessionView, streakLabel, type RecentSession, type PracticeStreak } from './homeEvidence';
import { PRODUCT_NAMES } from '@/constants/productNames';

export type { RecentSession };

type Accent = 'teal' | 'violet';

/* -------------------------------------------------------------------------------------------- */
/* Decorative motifs — aria-hidden; they carry no information that is not also in text.           */
/* -------------------------------------------------------------------------------------------- */

/** Five-bar waveform for the Freeform band. One bar is amber: the warm through-line. */
function BandWaveform({ warm }: { warm: boolean }) {
    const bars = [12, 22, 30, 18, 25];
    return (
        <span aria-hidden="true" data-testid="home-band-motif" className="flex items-end gap-[3px]">
            {bars.map((h, i) => (
                <span
                    key={i}
                    style={{
                        width: 4,
                        height: h,
                        borderRadius: 2,
                        background: warm && i === 2 ? 'var(--ss-home-amber-bar)' : 'rgba(255,255,255,0.85)',
                    }}
                />
            ))}
        </span>
    );
}

/** Four-bar mini waveform inside the streak chip. */
function StreakWaveform() {
    return (
        <span aria-hidden="true" className="flex items-end gap-[2px]">
            {[6, 11, 8, 13].map((h, i) => (
                <span key={i} style={{ width: 3, height: h, borderRadius: 1.5, background: '#d98a1f' }} />
            ))}
        </span>
    );
}

/* -------------------------------------------------------------------------------------------- */
/* Outcome tile                                                                                   */
/* -------------------------------------------------------------------------------------------- */

/**
 * How a tile's value should be typeset:
 *   metric  — a genuine numeric measurement, set large (27px extrabold). Reserved for real numbers.
 *   status  — a categorical word (e.g. `Live`): a quiet 13–14px bold that BLENDS into the tile and
 *             never competes with a metric. It occupies the same value-row height so labels align.
 *   missing — the em-dash placeholder for "not enough data", kept at metric size so an absent value
 *             reads as a deliberately blank metric, not as body copy.
 */
export type OutcomeValueKind = 'metric' | 'status' | 'missing';

export interface OutcomeTile {
    /** The artifact name. ONE line — the two cards' tile rows must align. Never repeats the value. */
    label: string;
    /** The value text — a metric number, a categorical status word, or the em-dash placeholder. */
    value: string;
    /** Chooses the value typography. The renderer keys off THIS, never the literal string. */
    valueKind: OutcomeValueKind;
    Icon: LucideIcon;
    /** `warm` is reserved for Freeform's MIDDLE tile — the amber thread to the marketing hero. */
    tone: Accent | 'warm';
}

const TONE_STYLE: Record<Accent | 'warm', { glyphBg: string; glyphInk: string; valueInk: string }> = {
    teal: { glyphBg: 'var(--ss-home-teal-tint)', glyphInk: 'var(--ss-home-teal-deep)', valueInk: 'var(--ss-home-teal-deep)' },
    violet: { glyphBg: 'var(--ss-home-violet-tint)', glyphInk: 'var(--ss-home-violet-deep)', valueInk: 'var(--ss-home-violet-deep)' },
    // Never white-on-orange: the warm tile is a light amber surface with dark brown ink.
    warm: { glyphBg: 'var(--ss-home-amber-tint)', glyphInk: 'var(--ss-home-amber-ink)', valueInk: 'var(--ss-home-amber-ink)' },
};

// Value typography by kind. `status` is the quiet, blend-in treatment for a categorical word; it
// keeps the value row at the metric's `min-h` so all three tile labels stay aligned.
const VALUE_CLASS: Record<OutcomeValueKind, string> = {
    metric: 'text-[27px] font-extrabold leading-none tracking-tight',
    status: 'flex min-h-[27px] items-center text-[14px] font-bold leading-none',
    missing: 'text-[27px] font-extrabold leading-none tracking-tight',
};

function OutcomeTileView({ tile, testid }: { tile: OutcomeTile; testid: string }) {
    const tone = TONE_STYLE[tile.tone];
    const missing = tile.valueKind === 'missing';
    return (
        <div data-testid={testid} data-evidence={missing ? 'none' : 'present'} className="flex min-w-0 flex-col gap-1.5">
            <span
                aria-hidden="true"
                className="grid h-8 w-8 place-items-center rounded-[9px]"
                style={{ background: tone.glyphBg, color: tone.glyphInk }}
            >
                <tile.Icon size={16} />
            </span>
            <span
                data-value-kind={tile.valueKind}
                className={VALUE_CLASS[tile.valueKind]}
                style={{ color: missing ? 'var(--ss-text-secondary)' : tone.valueInk }}
                // Screen readers should not spell out a bare dash; the label carries the meaning and
                // the visually-hidden phrase says why the number is absent.
                aria-hidden={missing ? 'true' : undefined}
            >
                {tile.value}
            </span>
            {missing && <span className="sr-only">{NOT_ENOUGH_DATA}</span>}
            {/* The label is the ONLY meaning-carrier when the value is an em-dash, so it must never
                be clipped: at 320-375px a three-tile row leaves ~75-90px per tile and "Vs. last time"
                over a dash would ellipsise into nonsense. It wraps instead. The CTA still bottom-aligns
                because it owns `margin-top: auto`, so an uneven label height cannot misalign the two
                cards' buttons. */}
            <span className="text-[12px] font-semibold leading-tight text-[color:var(--ss-text-secondary)]">
                {tile.label}
            </span>
        </div>
    );
}

/* -------------------------------------------------------------------------------------------- */
/* Product card                                                                                   */
/* -------------------------------------------------------------------------------------------- */

function ProductCard({
    accent, eyebrow, title, soon, expectTrailing, tiles, reassurance, ctaLabel, ctaAria, onCta, testid,
}: {
    accent: Accent;
    eyebrow: string;
    title: string;
    soon?: boolean;
    expectTrailing: string;
    tiles: OutcomeTile[];
    reassurance: string;
    ctaLabel: string;
    ctaAria: string;
    onCta: () => void;
    testid: string;
}) {
    const teal = accent === 'teal';
    return (
        <article data-testid={`${testid}-card`} className={`ss-home-card ${teal ? 'ss-home-card--teal' : 'ss-home-card--violet'}`}>
            {/* The TITLE lives in the coloured band so the choice can be made by scanning colour. */}
            <div className={`flex items-center justify-between gap-3 px-5 py-4 ${teal ? 'ss-home-band-teal' : 'ss-home-band-violet'}`}>
                <div className="min-w-0">
                    {/* Full-opacity white: at 11px bold, 80% white fell to ~2.4:1 on the band's light stop. */}
                    <span className="block text-[11px] font-extrabold uppercase tracking-[0.13em] text-white">{eyebrow}</span>
                    <h2 className="mt-0.5 text-[22px] font-extrabold tracking-tight text-white">{title}</h2>
                </div>
                {/* The SOON pill is a flex sibling, not absolutely positioned: it can never overlap
                    the title at a narrow width. */}
                {soon ? (
                    <span
                        data-testid="objective-soon-badge"
                        className="shrink-0 rounded-full px-3 py-1 text-[11px] font-extrabold tracking-[0.05em]"
                        style={{ background: 'rgba(255,255,255,0.94)', color: 'var(--ss-home-violet-deep)' }}
                    >
                        SOON
                    </span>
                ) : (
                    <BandWaveform warm />
                )}
            </div>

            <div className="flex flex-1 flex-col gap-4 p-5">
                {/* Expectation header. The eyebrow stays AMBER on BOTH cards — it is the connective
                    tissue between them, not a per-card accent. */}
                <div className="flex items-center gap-3">
                    <span className="shrink-0 text-[11px] font-extrabold uppercase tracking-[0.13em]" style={{ color: 'var(--ss-home-amber-eyebrow)' }}>
                        What to expect
                    </span>
                    <span aria-hidden="true" className="h-px flex-1" style={{ background: 'var(--ss-home-amber-rule)' }} />
                    <span className="shrink-0 text-[12px] font-semibold text-[color:var(--ss-text-secondary)]">{expectTrailing}</span>
                </div>

                {/* Equal-width columns, so a wrapped label in one tile cannot squeeze its neighbours. */}
                <div className="grid grid-cols-3 items-start gap-3" data-testid={`${testid}-tiles`}>
                    {tiles.map((t, i) => (
                        <OutcomeTileView key={t.label} tile={t} testid={`${testid}-tile-${i}`} />
                    ))}
                </div>

                <p
                    className="rounded-[10px] px-3.5 py-2.5 text-[13px] font-semibold"
                    style={{
                        background: teal ? 'var(--ss-home-teal-tint)' : 'var(--ss-home-violet-tint)',
                        color: teal ? 'var(--ss-home-teal-deep)' : 'var(--ss-home-violet-deep)',
                    }}
                >
                    {reassurance}
                </p>

                <button
                    type="button"
                    onClick={onCta}
                    data-testid={testid}
                    aria-label={ctaAria}
                    className={`ss-ring ss-home-cta ${teal ? 'ss-home-cta-solid' : 'ss-home-cta-outline'}`}
                >
                    {ctaLabel}
                    {teal
                        ? <ArrowRight size={16} aria-hidden="true" />
                        : <Music size={15} aria-hidden="true" />}
                </button>
            </div>
        </article>
    );
}

/* -------------------------------------------------------------------------------------------- */
/* Greeting row                                                                                   */
/* -------------------------------------------------------------------------------------------- */

function HeaderButton({
    label, secondary, secondaryCompact, secondaryTone, state, Icon, onClick, testid, disabled,
}: {
    label: string; secondary?: string; secondaryCompact?: boolean; secondaryTone?: string;
    state?: string; Icon: LucideIcon; onClick: () => void; testid: string; disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            // There is nothing to review when no session was persisted (or the read failed): the
            // control stays visible with its em-dash rather than vanishing, but it does not pretend
            // to lead somewhere.
            disabled={disabled}
            data-testid={testid}
            // The state is exposed programmatically as well as visually: "we couldn't read your
            // history" and "you haven't practised yet" are opposite facts and must be distinguishable
            // by a test and by a screen reader, not only by their wording.
            data-state={state}
            aria-busy={state === 'loading' ? true : undefined}
            className="ss-ring flex items-center gap-2.5 rounded-[11px] border bg-[color:var(--ss-surface)] px-3.5 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
            style={{ borderColor: 'var(--ss-home-card-border)' }}
        >
            <Icon size={16} aria-hidden="true" style={{ color: 'var(--ss-home-teal-deep)' }} className="shrink-0" />
            <span className="flex flex-col leading-tight">
                <span className="text-[13px] font-bold text-[color:var(--ss-text)]">{label}</span>
                {secondary && (
                    <span
                        className="text-[12px] font-medium"
                        style={{ color: secondaryTone ?? 'var(--ss-text-secondary)' }}
                        data-testid={`${testid}-secondary`}
                    >
                        {/* A bare em-dash in a button's accessible name is announced as "dash". The
                            visible glyph is hidden from assistive tech and paired with the full
                            sentence, exactly as the outcome tiles do. */}
                        <span aria-hidden={secondaryCompact ? 'true' : undefined}>{secondary}</span>
                        {secondaryCompact && <span className="sr-only">{NOT_ENOUGH_DATA}</span>}
                    </span>
                )}
            </span>
        </button>
    );
}

/* -------------------------------------------------------------------------------------------- */
/* Surface                                                                                        */
/* -------------------------------------------------------------------------------------------- */

export interface AuthenticatedHomeProps {
    lastSession: RecentSession | null;
    /** True while the recent-session read is IN FLIGHT — an em-dash here would claim an absence
     *  we have not yet established. */
    recentLoading: boolean;
    /** True when the recent-session read FAILED — must not masquerade as "no sessions". */
    recentFailed: boolean;
    /** Server-authoritative streak from `get_practice_streak` (#1098). The chip renders ONLY for an
     *  active streak of >=2 qualifying days; every other value (null/unavailable/lapsed/zero/one-day)
     *  renders no chip at all. Never `0-day`/`1-day`, never a localStorage guess. */
    streak: PracticeStreak | null;
    /** True while the streak read is IN FLIGHT (incl. immediately after an account change) — the chip
     *  stays hidden until an active >=2-day streak resolves (no skeleton, no premature label). */
    streakLoading: boolean;
    onStartFreeform: () => void;
    onNotifyObjective: () => void;
    onReviewLastSession: () => void;
    onViewAnalytics: () => void;
}

export function AuthenticatedHome({
    lastSession, recentLoading, recentFailed, streak, streakLoading,
    onStartFreeform, onNotifyObjective, onReviewLastSession, onViewAnalytics,
}: AuthenticatedHomeProps) {
    const last = lastSessionView(lastSession, { loading: recentLoading, failed: recentFailed });
    // The chip is shown ONLY for an active >=2-day streak. Loading, unavailable, lapsed, zero and
    // one-day states all resolve to `null` and render no chip (no skeleton, no reserved width).
    const streakText = streakLoading ? null : streakLabel(streak);
    // Freeform tiles. "Live" is a capability of the shipped product, not a claim about this user.
    // The other two have no truthful source on Home today, so they say so.
    const freeformTiles: OutcomeTile[] = [
        // `Live` is a categorical capability, not a measurement — a quiet `status` value that blends
        // into the tile rather than the large `metric` typography reserved for real numbers.
        { label: 'Transcript', value: 'Live', valueKind: 'status', Icon: FileText, tone: 'teal' },
        // No last-session filler count is available on Home (the recent-session read is deliberately
        // narrow: id/created_at/duration/status). A plausible number here would be a fabrication.
        { label: 'Filler words', value: NOT_ENOUGH_DATA_COMPACT, valueKind: 'missing', Icon: MessageSquare, tone: 'warm' },
        // Home must NOT invent its own comparison. Until SpeakSharp Progress ships there is no
        // defensible "vs. last time" figure, so none is shown.
        { label: 'Vs. last time', value: NOT_ENOUGH_DATA_COMPACT, valueKind: 'missing', Icon: TrendingUp, tone: 'teal' },
    ];

    // Objective has not launched: there are no results to report, and nothing here may look personalised.
    const objectiveTiles: OutcomeTile[] = [
        { label: 'Covered', value: NOT_ENOUGH_DATA_COMPACT, valueKind: 'missing', Icon: Check, tone: 'violet' },
        { label: 'Missed', value: NOT_ENOUGH_DATA_COMPACT, valueKind: 'missing', Icon: Target, tone: 'violet' },
        { label: 'Misses only', value: NOT_ENOUGH_DATA_COMPACT, valueKind: 'missing', Icon: Repeat, tone: 'violet' },
    ];

    return (
        // `ss-home-surface` owns the fixed-header offset (scroll-padding + top padding derived from
        // --header-height) so no descendant needs a magic number to clear the bar.
        <div data-testid="practice-welcome-authed" className="ss-home-surface mx-auto max-w-[1120px] px-5 pb-28 [padding-bottom:calc(7rem+env(safe-area-inset-bottom))] sm:px-8 md:pb-12 md:[padding-bottom:3rem]">
            {/* Greeting ROW — no peach band, no tagline, no status card. The page asks; it does not pitch. */}
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <span className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-[color:var(--ss-text-secondary)]">
                        Welcome back
                    </span>
                    <h1
                        className="mt-1 font-extrabold text-[color:var(--ss-text)]"
                        style={{ fontSize: 'clamp(30px, 5vw, 42px)', lineHeight: 1.05, letterSpacing: '-0.03em' }}
                    >
                        What would you like to do?
                    </h1>
                </div>

                {/* The continuity cluster is its own element so it can be scrolled to, hit-tested and
                    screenshotted independently of the (much taller) surface around it. */}
                <div data-testid="home-continuity-cluster" className="ss-home-anchor flex flex-wrap items-center gap-2.5">
                    {/* Shown ONLY for an earned, active streak of two or more qualifying days (server-
                        authoritative `get_practice_streak`, #1098). Loading, unavailable, lapsed, zero
                        and one-day states render NOTHING here — no skeleton, no placeholder, no reserved
                        width. When absent, the flex cluster naturally leads with Last session → Analytics;
                        when present, streak → Last session → Analytics. Never `0-day`/`1-day`. */}
                    {streakText !== null && (
                        <span
                            data-testid="home-streak-chip"
                            data-streak-state={streak?.state ?? 'active'}
                            className="inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-bold"
                            style={{ background: '#fdf3e2', border: '1px solid #f0dcb8', color: '#8a5510' }}
                        >
                            <StreakWaveform />
                            {streakText}
                        </span>
                    )}
                    <HeaderButton
                        label="Last session"
                        secondary={last.text}
                        secondaryCompact={last.compact}
                        secondaryTone={last.state === 'failed' ? 'var(--ss-home-warn-ink)' : undefined}
                        state={last.state}
                        Icon={FileText}
                        onClick={onReviewLastSession}
                        testid="home-last-session"
                        disabled={!last.canReview}
                    />
                    <HeaderButton label="Analytics" Icon={BarChart3} onClick={onViewAnalytics} testid="home-analytics" />
                </div>
            </div>

            {/* A FAILED read gets its own honest region — it must never be shown as emptiness. This
                restores the distinct error state that the deleted continuity card carried. */}
            {last.state === 'failed' && (
                <p
                    role="status"
                    data-testid="home-history-error"
                    className="mt-4 flex items-center gap-2 rounded-[10px] px-3.5 py-2.5 text-[13px] font-semibold"
                    style={{ background: 'var(--ss-home-warn-tint)', color: 'var(--ss-home-warn-ink)' }}
                >
                    <AlertCircle size={15} aria-hidden="true" className="shrink-0" />
                    We couldn’t load your recent practice. You can still start {PRODUCT_NAMES.freeform} below.
                </p>
            )}

            {/* First run — truthful guidance rather than six unexplained placeholders. Only shown when
                the read SUCCEEDED and genuinely returned nothing. */}
            {last.state === 'empty' && (
                <p
                    data-testid="home-first-run"
                    className="mt-4 flex items-center gap-2 rounded-[10px] px-3.5 py-2.5 text-[13px] font-semibold"
                    style={{ background: 'var(--ss-home-teal-tint)', color: 'var(--ss-home-teal-deep)' }}
                >
                    <Sparkles size={15} aria-hidden="true" className="shrink-0" />
                    Start your first practice — your transcript and progress appear here once you finish.
                </p>
            )}

            <div className="ss-home-grid mt-8">
                <ProductCard
                    accent="teal"
                    eyebrow="Speak freely"
                    title={PRODUCT_NAMES.freeform}
                    expectTrailing="in ~5 min"
                    tiles={freeformTiles}
                    reassurance="No agenda or setup — just speak and improve"
                    ctaLabel={`Start ${PRODUCT_NAMES.freeform}`}
                    ctaAria={`Start ${PRODUCT_NAMES.freeform}`}
                    onCta={onStartFreeform}
                    testid="practice-card-freeform"
                />
                <ProductCard
                    accent="violet"
                    eyebrow="Hit your points"
                    title={PRODUCT_NAMES.objective}
                    soon
                    expectTrailing="at launch"
                    tiles={objectiveTiles}
                    reassurance="Set your points, rehearse until they land"
                    ctaLabel="Notify me at launch"
                    ctaAria={`Notify me about ${PRODUCT_NAMES.objective}`}
                    onCta={onNotifyObjective}
                    testid="practice-card-objective"
                />
            </div>
        </div>
    );
}
