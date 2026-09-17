/**
 * Design Correction Brief H-1…H-5 / `HOME_PAGE_SPEC.md` Rev 1 — the authenticated Home surface.
 *
 * THREE SLOTS (G1). Content changes; slots never move.
 *
 *     ┌─────────────────────────────────────────────┐  A  greeting
 *     ├─────────────────────────────────────────────┤  B  full width, INK — resume the loop
 *     ├───────────────────────────┬─────────────────┤
 *     │ C  Open Mic               │ C  Focus Points │  two PEER cards
 *     └───────────────────────────┴─────────────────┘
 *
 * **For a returning user this page is the top of the Practice Loop; for a first-time user it is a fork in
 * the road.** It serves whichever user is in front of it and never shows both answers at once, so slot B is
 * absent — not empty, not disabled — until there is a session to resume.
 *
 * What the previous build got wrong, and why each is a rule rather than a restyle:
 *
 * - **H-1 CTA asymmetry.** A yellow fill beside a purple *outline* read as "this one is secondary or
 *   unavailable", when both paths are primary. Purple identifies the product; yellow is the only action
 *   colour (G2). Both CTAs are now the same signature fill at the same size, and no outlined button
 *   renders here.
 * - **H-2 purple flood.** The two products are peers, so they are ONE component with two content sets.
 *   They differ in exactly two rendered colours — a 3px top rule and the eyebrow — and nothing else.
 * - **H-3 placeholder metrics.** The `WHAT TO EXPECT` row promised data this page has no source for and
 *   rendered em-dashes under real labels: a card stating what it cannot show (G4). The row, its icon
 *   tiles, its `in ~5 min` / `every session` captions and the tinted strip are gone — four rows of chrome
 *   for one sentence of meaning. Each card is now eyebrow · title · ONE sentence · CTA, with no numbers.
 * - **H-4 the resume band.** `Last session` was a 12px corner chip: the page's most valuable element sized
 *   as its least. It is now slot B, full width and on ink, above the cards.
 * - **H-5 yellow budget.** Yellow means "act", so it is one fill per view plus the logo. The two card CTAs
 *   count as one use because the cards are peers; the resume CTA is the other.
 *
 * WHAT SLOT B SAYS. First choice is the spec's: **the fix, verbatim from that session's review**, so the
 * lesson is recognisable rather than restated. `getRecentReviewable` reads the review `get-ai-suggestions`
 * already cached on the session row and `readLastSessionFix` reduces it to that one sentence — a read, not
 * new persistence, and #1306's client-persistence rule is untouched (see `lastSessionFix.ts`).
 *
 * When there is no contract-valid review to quote — it failed, is still being made, or the row is a partial
 * write — the band still renders, on the run's own earned facts, with the same enabled CTA. That is the
 * spec's own fallback, and it is deliberately NOT a band announcing that a review is unavailable: that dead
 * end is what `SESSION_PAGE_SPEC.md` §5b exists to prevent. No number is invented in either shape.
 *
 * Still deferred rather than faked: a `Practice this again` that reopens the same product with the same
 * prompt or point set. Nothing readable here identifies which product the last run was, so the CTA leads to
 * the run's own review instead of guessing.
 */

import * as React from 'react';
import { AlertCircle, BarChart3, FileText, type LucideIcon } from 'lucide-react';
import { NOT_ENOUGH_DATA } from '@/utils/metricValidity';
import { lastSessionView, streakLabel, type RecentSession, type PracticeStreak } from './homeEvidence';
import { PRODUCT_NAMES } from '@/constants/productNames';

export type { RecentSession };

/* -------------------------------------------------------------------------------------------- */
/* Decorative motif — aria-hidden; carries no information that is not also in text.                */
/* -------------------------------------------------------------------------------------------- */

/** Four-bar mini waveform inside the streak chip. */
function StreakWaveform() {
    return (
        <span aria-hidden="true" className="flex items-end gap-[2px]">
            {[6, 11, 8, 13].map((h, i) => (
                <span key={i} style={{ width: 3, height: h, borderRadius: 1.5, background: 'var(--brand-signature)' }} />
            ))}
        </span>
    );
}

/* -------------------------------------------------------------------------------------------- */
/* Slot C — the two peer product cards                                                            */
/* -------------------------------------------------------------------------------------------- */

/**
 * ONE component, two content sets (H-2). `identity` selects the only two colours that may differ: the
 * 3px top rule and the eyebrow. Everything else — surface, border, radius, padding, type scale, CTA fill
 * and CTA size — is shared, because any further difference makes one product shout and the other recede.
 */
function ProductCard({
    identity, eyebrow, title, sentence, ctaLabel, ctaAria, onCta, testid,
}: {
    identity: 'open-mic' | 'focus-points';
    eyebrow: string;
    title: string;
    sentence: string;
    ctaLabel: string;
    ctaAria: string;
    onCta: () => void;
    testid: string;
}) {
    // Open Mic is the ink identity; Focus Points is the Focus purple. Both come from the shared theme
    // authority (#1481) — this page holds no colour values of its own.
    const identityColor = identity === 'open-mic' ? 'var(--brand-ink)' : 'var(--brand-focus-strong)';
    return (
        <article
            data-testid={`${testid}-card`}
            data-identity={identity}
            className="ss-home-card"
            // The rule is a border, not a filled band: a saturated header is the H-2 flood.
            style={{ borderTop: `3px solid ${identityColor}` }}
        >
            <div className="flex flex-1 flex-col gap-3 p-[26px] pb-[22px]">
                <span
                    data-testid={`${testid}-eyebrow`}
                    className="text-[12px] font-extrabold uppercase tracking-[0.1em]"
                    style={{ color: identityColor }}
                >
                    {eyebrow}
                </span>
                <h2 className="text-[24px] font-extrabold leading-tight tracking-tight text-[color:var(--ss-text)]">{title}</h2>
                {/* ONE sentence saying what the product is for. Not a feature list, not a tile grid. */}
                <p data-testid={`${testid}-sentence`} className="text-[17px] font-medium leading-snug text-[color:var(--ss-text)]">
                    {sentence}
                </p>
                <button
                    type="button"
                    onClick={onCta}
                    data-testid={testid}
                    aria-label={ctaAria}
                    className="ss-ring ss-home-cta ss-home-cta-solid"
                >
                    {ctaLabel}
                </button>
            </div>
        </article>
    );
}

/* -------------------------------------------------------------------------------------------- */
/* Slot B — the resume band                                                                       */
/* -------------------------------------------------------------------------------------------- */

/**
 * The loop closing (H-4). Rendered ONLY for a present, reviewable session: a band with nothing to resume
 * advertises a feature the user cannot use yet, so the first-session page omits the slot entirely.
 *
 * `headline` is what this run earned — never a zero, never a placeholder. `meta` may be absent when the
 * stored row cannot describe itself, in which case the band still leads somewhere.
 */
function ResumeBand({
    fix, meta, onReview, onViewAnalytics,
}: {
    /** The verbatim fix from the last review, or null when there is none to quote. */
    fix: string | null;
    meta: string | null;
    onReview: () => void;
    onViewAnalytics: () => void;
}) {
    return (
        <section
            data-testid="home-resume-band"
            aria-label="Resume your practice"
            // Flat ink fill: no gradient, no overlay, no opacity on a ground (G2).
            className="mt-6 flex flex-col gap-4 rounded-[14px] bg-ink px-7 py-6 text-ink-text md:flex-row md:items-end md:justify-between"
        >
            <div className="min-w-0">
                <p className="text-[12px] font-extrabold uppercase tracking-[0.1em] text-signature" data-testid="home-resume-eyebrow">
                    From your last session
                </p>
                {/* The lesson itself when we have it; otherwise the run, never an apology for the review. */}
                <p
                    className="mt-2 max-w-[720px] text-[22px] font-extrabold leading-snug text-ink-text"
                    data-testid="home-resume-headline"
                    data-source={fix ? 'review-fix' : 'run-facts'}
                >
                    {fix ?? 'Your last run is ready to pick up.'}
                </p>
                {meta && (
                    <p className="mt-1.5 text-[15px] font-medium text-ink-muted" data-testid="home-resume-meta">
                        {meta}
                    </p>
                )}
            </div>
            <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
                <button
                    type="button"
                    onClick={onReview}
                    data-testid="home-resume-cta"
                    className="ss-ring ss-home-cta ss-home-cta-solid"
                >
                    Pick up where you left off
                </button>
                <button
                    type="button"
                    onClick={onViewAnalytics}
                    data-testid="home-resume-progress"
                    className="ss-ring text-[15px] font-semibold text-ink-muted underline-offset-2 hover:underline"
                >
                    See your progress
                </button>
            </div>
        </section>
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
            <Icon size={16} aria-hidden="true" style={{ color: 'var(--ss-text-secondary)' }} className="shrink-0" />
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
                            sentence. */}
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
    onStartObjective: () => void;
    onReviewLastSession: () => void;
    onViewAnalytics: () => void;
}

export function AuthenticatedHome({
    lastSession, recentLoading, recentFailed, streak, streakLoading,
    onStartFreeform, onStartObjective, onReviewLastSession, onViewAnalytics,
}: AuthenticatedHomeProps) {
    const last = lastSessionView(lastSession, { loading: recentLoading, failed: recentFailed });
    // The chip is shown ONLY for an active >=2-day streak. Loading, unavailable, lapsed, zero and
    // one-day states all resolve to `null` and render no chip (no skeleton, no reserved width).
    const streakText = streakLoading ? null : streakLabel(streak);
    // Slot B exists only for a session that is genuinely there and can be opened. `loading`, `failed`
    // and `empty` each keep their own honest surface below, and none of them renders a band.
    const resuming = last.state === 'present' && last.canReview;
    // `last.text` is composed from persisted columns only (date · duration) and is `NOT_ENOUGH_DATA`
    // when neither is displayable. In the band the dash is dropped rather than shown: under a quoted
    // lesson it would read as a missing value in the lesson itself.
    const bandMeta = last.compact ? null : last.text;

    return (
        // `ss-home-surface` owns the fixed-header offset (scroll-padding + top padding derived from
        // --header-height) so no descendant needs a magic number to clear the bar.
        <div data-testid="practice-welcome-authed" className="ss-home-surface mx-auto max-w-[1100px] px-5 pb-28 [padding-bottom:calc(7rem+env(safe-area-inset-bottom))] sm:px-8 md:pb-12 md:[padding-bottom:3rem]">
            {/* SLOT A — greeting. The H1 IS the question; the cards are the answers. */}
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <span className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-[color:var(--ss-text-secondary)]">
                        {resuming ? 'Welcome back' : 'Welcome'}
                    </span>
                    <h1
                        className="mt-1 font-extrabold text-[color:var(--ss-text)]"
                        style={{ fontSize: 'clamp(30px, 5vw, 42px)', lineHeight: 1.05, letterSpacing: '-0.03em' }}
                    >
                        {resuming ? 'What would you like to do?' : 'Pick how you want to practise.'}
                    </h1>
                </div>

                {/* The continuity cluster is its own element so it can be scrolled to, hit-tested and
                    screenshotted independently of the (much taller) surface around it. */}
                <div data-testid="home-continuity-cluster" className="ss-home-anchor flex flex-wrap items-center gap-2.5">
                    {/* Shown ONLY for an earned, active streak of two or more qualifying days (server-
                        authoritative `get_practice_streak`, #1098). Loading, unavailable, lapsed, zero
                        and one-day states render NOTHING here — no skeleton, no placeholder, no reserved
                        width. Never `0-day`/`1-day`. */}
                    {streakText !== null && (
                        <span
                            data-testid="home-streak-chip"
                            data-streak-state={streak?.state ?? 'active'}
                            className="inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-bold"
                            style={{ background: 'var(--brand-signature-ground)', border: '1px solid var(--brand-signature-border)', color: 'var(--brand-signature-text)' }}
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

            {/* SLOT B — the resume band. Absent on a first session (H-4), and absent while the read is
                in flight or after it failed: those states have their own surfaces and neither of them
                knows whether there is anything to resume. */}
            {resuming && (
                <ResumeBand
                    fix={lastSession?.fix ?? null}
                    meta={bandMeta}
                    onReview={onReviewLastSession}
                    onViewAnalytics={onViewAnalytics}
                />
            )}

            {/* A FAILED read gets its own honest region — it must never be shown as emptiness. */}
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

            {/* SLOT C — two peers. Same component, two content sets. */}
            <div className="ss-home-grid mt-8">
                <ProductCard
                    identity="open-mic"
                    eyebrow="Speak freely"
                    title={PRODUCT_NAMES.freeform}
                    sentence="Just speak. Your transcript, fillers and pace, live."
                    ctaLabel="Start your session"
                    ctaAria="Start your session"
                    onCta={onStartFreeform}
                    testid="practice-card-freeform"
                />
                <ProductCard
                    identity="focus-points"
                    eyebrow="Hit your points"
                    title={PRODUCT_NAMES.objective}
                    sentence="Name the points that must land, then check which ones did."
                    ctaLabel="Set your focus points"
                    ctaAria={`Start ${PRODUCT_NAMES.objective}`}
                    onCta={onStartObjective}
                    testid="practice-card-objective"
                />
            </div>

            {/* First session only: the differentiator, stated once, at the moment the user is about to
                grant mic access (spec §6). A returning user has already granted it and does not need
                to be told again. */}
            {last.state === 'empty' && (
                <p data-testid="home-first-run" className="mt-5 text-[15px] font-medium text-[color:var(--ss-text-secondary)]">
                    Your audio never leaves this browser.
                </p>
            )}
        </div>
    );
}
