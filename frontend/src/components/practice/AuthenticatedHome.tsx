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
 * A user should be able to choose by scanning the two colour blocks (teal = Freestyle, violet =
 * Guided), which is why each card's TITLE lives inside its coloured header band and not in the
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
 * Guided is unavailable, so every Guided tile is an em-dash or a capability label. It shows nothing
 * that could be mistaken for the user's personalised results, and its CTA activates nothing.
 */

import * as React from 'react';
import {
    ArrowRight, BarChart3, FileText, MessageSquare, TrendingUp,
    Check, Target, Repeat, type LucideIcon,
} from 'lucide-react';
import { NO_EVIDENCE, lastSessionSummary, streakLabel, type RecentSession } from './homeEvidence';

export type { RecentSession };

type Accent = 'teal' | 'violet';

/* -------------------------------------------------------------------------------------------- */
/* Decorative motifs — aria-hidden; they carry no information that is not also in text.           */
/* -------------------------------------------------------------------------------------------- */

/** Five-bar waveform for the Freestyle band. One bar is amber: the warm through-line. */
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
                <span key={i} style={{ width: 3, height: h, borderRadius: 1.5, background: 'var(--ss-home-amber)' }} />
            ))}
        </span>
    );
}

/* -------------------------------------------------------------------------------------------- */
/* Outcome tile                                                                                   */
/* -------------------------------------------------------------------------------------------- */

export interface OutcomeTile {
    /** The artifact name. ONE line — the two cards' tile rows must align. Never repeats the value. */
    label: string;
    /** The large value, or `NO_EVIDENCE` when there is no truthful source. */
    value: string;
    Icon: LucideIcon;
    /** `warm` is reserved for Freestyle's MIDDLE tile — the amber thread to the marketing hero. */
    tone: Accent | 'warm';
}

const TONE_STYLE: Record<Accent | 'warm', { glyphBg: string; glyphInk: string; valueInk: string }> = {
    teal: { glyphBg: 'var(--ss-home-teal-tint)', glyphInk: 'var(--ss-home-teal-deep)', valueInk: 'var(--ss-home-teal-deep)' },
    violet: { glyphBg: 'var(--ss-home-violet-tint)', glyphInk: 'var(--ss-home-violet-deep)', valueInk: 'var(--ss-home-violet-deep)' },
    // Never white-on-orange: the warm tile is a light amber surface with dark brown ink.
    warm: { glyphBg: 'var(--ss-home-amber-tint)', glyphInk: 'var(--ss-home-amber-ink)', valueInk: 'var(--ss-home-amber-ink)' },
};

function OutcomeTileView({ tile, testid }: { tile: OutcomeTile; testid: string }) {
    const tone = TONE_STYLE[tile.tone];
    const missing = tile.value === NO_EVIDENCE;
    return (
        <div data-testid={testid} data-evidence={missing ? 'none' : 'present'} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span
                aria-hidden="true"
                className="grid h-8 w-8 place-items-center rounded-[9px]"
                style={{ background: tone.glyphBg, color: tone.glyphInk }}
            >
                <tile.Icon size={16} />
            </span>
            <span
                className="text-[27px] font-extrabold leading-none tracking-tight"
                style={{ color: missing ? 'var(--ss-text-secondary)' : tone.valueInk }}
                // Screen readers should not spell out a bare dash; the label carries the meaning and
                // the visually-hidden phrase says why the number is absent.
                aria-hidden={missing ? 'true' : undefined}
            >
                {tile.value}
            </span>
            {missing && <span className="sr-only">Not enough data yet</span>}
            <span className="truncate whitespace-nowrap text-[12px] font-semibold text-[color:var(--ss-text-secondary)]">
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
        <article data-testid={`${testid}-card`} className="ss-home-card">
            {/* The TITLE lives in the coloured band so the choice can be made by scanning colour. */}
            <div className={`flex items-center justify-between gap-3 px-5 py-4 ${teal ? 'ss-home-band-teal' : 'ss-home-band-violet'}`}>
                <div className="min-w-0">
                    <span className="block text-[11px] font-extrabold uppercase tracking-[0.13em] text-white/80">{eyebrow}</span>
                    <h2 className="mt-0.5 text-[22px] font-extrabold tracking-tight text-white">{title}</h2>
                </div>
                {/* The SOON pill is a flex sibling, not absolutely positioned: it can never overlap
                    the title at a narrow width. */}
                {soon ? (
                    <span
                        data-testid="guided-soon-badge"
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
                    <span className="shrink-0 text-[11px] font-extrabold uppercase tracking-[0.13em]" style={{ color: 'var(--ss-home-amber)' }}>
                        What to expect
                    </span>
                    <span aria-hidden="true" className="h-px flex-1" style={{ background: 'var(--ss-home-amber-rule)' }} />
                    <span className="shrink-0 text-[12px] font-semibold text-[color:var(--ss-text-secondary)]">{expectTrailing}</span>
                </div>

                <div className="flex items-start gap-3" data-testid={`${testid}-tiles`}>
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
                        : <span aria-hidden="true" className="text-base leading-none">♪</span>}
                </button>
            </div>
        </article>
    );
}

/* -------------------------------------------------------------------------------------------- */
/* Greeting row                                                                                   */
/* -------------------------------------------------------------------------------------------- */

function HeaderButton({
    label, secondary, Icon, onClick, testid, disabled,
}: { label: string; secondary?: string; Icon: LucideIcon; onClick: () => void; testid: string; disabled?: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            // There is nothing to review when no session was persisted (or the read failed): the
            // control stays visible with its em-dash rather than vanishing, but it does not pretend
            // to lead somewhere.
            disabled={disabled}
            data-testid={testid}
            className="ss-ring flex items-center gap-2.5 rounded-[11px] border bg-[color:var(--ss-surface)] px-3.5 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
            style={{ borderColor: 'var(--ss-home-card-border)' }}
        >
            <Icon size={16} aria-hidden="true" style={{ color: 'var(--ss-home-teal-deep)' }} className="shrink-0" />
            <span className="flex flex-col leading-tight">
                <span className="text-[13px] font-bold text-[color:var(--ss-text)]">{label}</span>
                {secondary && (
                    <span className="text-[12px] font-medium text-[color:var(--ss-text-secondary)]" data-testid={`${testid}-secondary`}>
                        {secondary}
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
    /** True when the recent-session read FAILED — must not masquerade as "no sessions". */
    recentFailed: boolean;
    /** Persisted streak from check-usage-limit. Anything non-finite renders an em-dash. */
    streakCount: number | null | undefined;
    onStartFreestyle: () => void;
    onNotifyGuided: () => void;
    onReviewLastSession: () => void;
    onViewAnalytics: () => void;
}

export function AuthenticatedHome({
    lastSession, recentFailed, streakCount,
    onStartFreestyle, onNotifyGuided, onReviewLastSession, onViewAnalytics,
}: AuthenticatedHomeProps) {
    // Freestyle tiles. "Live" is a capability of the shipped product, not a claim about this user.
    // The other two have no truthful source on Home today, so they say so.
    const freestyleTiles: OutcomeTile[] = [
        { label: 'Transcript', value: 'Live', Icon: FileText, tone: 'teal' },
        // No last-session filler count is available on Home (the recent-session read is deliberately
        // narrow: id/created_at/duration/status). A plausible number here would be a fabrication.
        { label: 'Filler words', value: NO_EVIDENCE, Icon: MessageSquare, tone: 'warm' },
        // Home must NOT invent its own comparison. Until SpeakSharp Progress ships there is no
        // defensible "vs. last time" figure, so none is shown.
        { label: 'Vs. last time', value: NO_EVIDENCE, Icon: TrendingUp, tone: 'teal' },
    ];

    // Guided has not launched: there are no results to report, and nothing here may look personalised.
    const guidedTiles: OutcomeTile[] = [
        { label: 'Covered', value: NO_EVIDENCE, Icon: Check, tone: 'violet' },
        { label: 'Missed', value: NO_EVIDENCE, Icon: Target, tone: 'violet' },
        { label: 'Misses only', value: NO_EVIDENCE, Icon: Repeat, tone: 'violet' },
    ];

    return (
        <div data-testid="practice-welcome-authed" className="mx-auto max-w-[1120px] px-5 pb-28 pt-24 [padding-bottom:calc(7rem+env(safe-area-inset-bottom))] sm:px-8 md:pb-12 md:[padding-bottom:3rem]">
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

                <div className="flex flex-wrap items-center gap-2.5">
                    <span
                        data-testid="home-streak-chip"
                        className="inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-bold"
                        style={{ background: 'var(--ss-home-amber-tint)', color: 'var(--ss-home-amber-ink)' }}
                    >
                        <StreakWaveform />
                        {streakLabel(streakCount)}
                    </span>
                    <HeaderButton
                        label="Last session"
                        secondary={lastSessionSummary(lastSession, recentFailed)}
                        Icon={FileText}
                        onClick={onReviewLastSession}
                        testid="home-last-session"
                        disabled={recentFailed || !lastSession}
                    />
                    <HeaderButton label="Analytics" Icon={BarChart3} onClick={onViewAnalytics} testid="home-analytics" />
                </div>
            </div>

            <div className="ss-home-grid mt-8">
                <ProductCard
                    accent="teal"
                    eyebrow="Speak freely"
                    title="Freestyle Practice"
                    expectTrailing="in ~5 min"
                    tiles={freestyleTiles}
                    reassurance="No agenda or setup — just speak and improve"
                    ctaLabel="Start Freestyle Practice"
                    ctaAria="Start Freestyle Practice"
                    onCta={onStartFreestyle}
                    testid="practice-card-quick"
                />
                <ProductCard
                    accent="violet"
                    eyebrow="Hit your points"
                    title="Guided Rehearsal"
                    soon
                    expectTrailing="at launch"
                    tiles={guidedTiles}
                    reassurance="Set your points, rehearse until they land"
                    ctaLabel="Notify me at launch"
                    ctaAria="Notify me about Guided Rehearsal"
                    onCta={onNotifyGuided}
                    testid="practice-card-guided"
                />
            </div>
        </div>
    );
}
