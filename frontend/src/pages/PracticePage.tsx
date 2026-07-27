/**
 * PracticePage — the authenticated `/practice` landing (orientation before recording controls). This is
 * the default authenticated entry.
 *
 * Freestyle Practice is the only working product: its card ("Start Freestyle Practice") navigates DIRECTLY
 * to the UNCHANGED /session (#1042 PR3 — a pure navigation handoff; this page imports/changes nothing in the
 * session runtime and never auto-starts recording). The "How Freestyle Practice works" guide now lives as a
 * Session-page overlay (#1042 PR2), not a full-page overview. Guided Rehearsal is future direction and NOT available:
 * selecting it stays on /practice and shows exactly one toast ("Product not available at this time") — no
 * preview, no microphone, AI, DB, network, or persistence. Report Issue stays in the global authenticated
 * Navigation and is surface-aware via the active practice surface. Warm Theme A visuals are scoped under
 * `.practice-root` (see styles/practice.css).
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Check, Clock, Info,
  LineChart, Target, AudioLines, ListChecks, Repeat,
  type LucideIcon,
} from 'lucide-react';
import '@/styles/practice.css';
import { LandingHeroArt, QuickPracticeArt, GuidedRehearsalArt } from '@/components/practice/practiceArt';
import { usePracticeSurface } from '@/components/practice/PracticeSurfaceContext';
import { PracticeContinuity } from '@/components/practice/PracticeContinuity';
import { useRecentPracticeSummary } from '@/hooks/useRecentPracticeSummary';
import type { PracticeSurface } from '@/services/pageContext';
import {
  trackPracticeEntryViewed, trackPracticeModeSelected,
  trackQuickPracticeStarted, trackGuidedRehearsalUnavailable,
} from '@/services/practiceTelemetry';

/** The ONLY Guided message shown in this release — as a CONTEXTUAL notice anchored to the Guided card. */
export const GUIDED_UNAVAILABLE_MESSAGE = 'Product not available at this time';

/**
 * Informational (not destructive) notice anchored beneath the Guided CTA; announced via role="status".
 * CRITICAL: this renders OUTSIDE the Guided card's dimmed subtree, so it stays at full opacity even while
 * the card is muted. Warm opaque surface, navy text, a bold 3px ORANGE edge + icon (brand color, not red).
 */
function GuidedUnavailableNotice() {
  return (
    <p role="status" data-testid="guided-unavailable-notice"
      className="ss-slide-in mt-3 inline-flex max-w-xs items-start gap-2 rounded-md border border-[color:var(--ss-amber-border)] border-l-[3px] border-l-[color:var(--ss-amber)] bg-[color:var(--ss-amber-surface)] px-3 py-2 text-sm font-semibold text-[color:var(--ss-text)] opacity-100 shadow-[0_2px_8px_rgba(15,23,42,0.12)]">
      <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-[color:var(--ss-amber)]" />
      <span>{GUIDED_UNAVAILABLE_MESSAGE}</span>
    </p>
  );
}

const QUICK_VARS: React.CSSProperties = {
  ['--ss-card' as string]: 'var(--ss-session-accent)', ['--ss-card-btn' as string]: 'var(--ss-session-btn)',
  ['--ss-card-soft' as string]: 'var(--ss-session-soft)', ['--ss-card-panel' as string]: 'var(--ss-session-panel)',
  ['--ss-card-border' as string]: 'var(--ss-session-border)', ['--ss-card-warm' as string]: 'var(--ss-sun)',
  // Deep teal INK for the illustration so the waveform/transcript read clearly on the LIGHT teal band.
  ['--ss-art-ink' as string]: '#065E5A',
};
const GUIDED_VARS: React.CSSProperties = {
  ['--ss-card' as string]: 'var(--ss-exec-accent)', ['--ss-card-btn' as string]: 'var(--ss-exec-btn)',
  ['--ss-card-soft' as string]: 'var(--ss-exec-soft)', ['--ss-card-panel' as string]: 'var(--ss-exec-panel)',
  ['--ss-card-border' as string]: 'var(--ss-exec-border)', ['--ss-card-warm' as string]: 'var(--ss-coral)',
};

// Short visual product lists — three concise, scannable capabilities per card (no dense paragraph).
const QUICK_BULLETS: Bullet[] = [
  { text: 'No agenda or setup', Icon: Check },
  { text: 'Speak and see your live transcript', Icon: AudioLines },
  { text: 'Review fillers, delivery, and progress', Icon: LineChart },
];
const GUIDED_BULLETS: Bullet[] = [
  { text: 'Prepare the points you need to cover', Icon: ListChecks },
  { text: 'Track covered and missed points', Icon: Target },
  { text: 'Rehearse corrections before the real moment', Icon: Repeat },
];

interface Bullet { text: string; Icon: LucideIcon }

function ModeCard({ vars, art, title, promise, bullets, marker, markerIcon, ctaLabel, ctaAria, ctaSolid, onClick, testid, disabled, ctaLabelDisabled, ctaAriaDisabled, notice }: {
  vars: React.CSSProperties; art: React.ReactNode; title: string; promise: string; bullets: Bullet[];
  marker: string; markerIcon?: LucideIcon; ctaLabel: string; ctaAria: string; ctaSolid?: boolean; onClick: () => void; testid: string;
  disabled?: boolean; ctaLabelDisabled?: string; ctaAriaDisabled?: string; notice?: React.ReactNode;
}) {
  // The marker icon reinforces status WITHOUT relying on color: a check for an available product, a clock
  // for a planned/unavailable one. A checkmark on an unavailable product would wrongly imply "ready".
  const MarkerIcon = markerIcon ?? Check;
  const isDisabled = !!disabled;
  // Disabled treatment (this card ONLY): the semantic state is carried by the CTA text change + native
  // disabled + the Clock/marker text — never opacity/color alone. Title/bullets stay readable.
  const label = isDisabled ? (ctaLabelDisabled ?? ctaLabel) : ctaLabel;
  const aria = isDisabled ? (ctaAriaDisabled ?? ctaAria) : ctaAria;
  // CTA style: a SOLID accent button is the strongest action (Quick's primary); an OUTLINE button reads as
  // secondary (Guided). When disabled, drop the accent entirely for a neutral, muted control. Sharp 8px.
  const ctaClass = isDisabled
    ? 'mt-4 inline-flex w-fit cursor-not-allowed items-center gap-1.5 rounded-lg border border-[color:var(--ss-border)] bg-[color:var(--ss-neutral-soft)] px-4 py-2 text-sm font-semibold text-[color:var(--ss-neutral-text)]'
    : `ss-ring mt-4 inline-flex w-fit items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold ${ctaSolid ? 'ss-accent-btn shadow-sm' : 'ss-accent-outline'}`;
  // Semantic card: an <article> with a real heading and a single, keyboard-operable CTA <button>. The card
  // is NOT itself a button (an interactive element must not contain headings/lists — invalid HTML + bad
  // for AT). The product reads from the heading, benefit, a short visual list, and marker (text, never
  // color alone); the button carries the action. Sharp geometry (10px card / crisp tinted border) so the
  // two modes read as distinct and confident. The card itself is NEVER opacity-dimmed — the dimming is
  // scoped to the inner content subtree ONLY, so the contextual notice below can stay fully legible.
  return (
    <article style={vars} data-disabled={isDisabled || undefined}
      className={`group ss-mode-card flex flex-col overflow-hidden rounded-[10px] bg-[color:var(--ss-surface)] transition-all duration-200 ${isDisabled
        ? 'shadow-[0_2px_10px_rgba(15,23,42,0.07)] ring-1 ring-[color:var(--ss-border)]'
        : 'shadow-[0_6px_20px_rgba(15,23,42,0.10)] ring-2 ring-[color:var(--ss-card-border)] hover:-translate-y-0.5 hover:shadow-[0_10px_26px_rgba(15,23,42,0.14)] hover:ring-[color:var(--ss-card)]'}`}>
      {/* Dimmed subtree = everything EXCEPT the notice. Muting the art + content here (not the <article>)
          keeps the sibling notice at full opacity. data-dimmed marks it so tests can prove the notice is
          rendered OUTSIDE this subtree. */}
      <div data-dimmed={isDisabled || undefined} className={`flex flex-1 flex-col ${isDisabled ? 'opacity-[0.6]' : ''}`}>
        <div className="ss-card-panel relative h-[4.75rem] border-b-2 border-[color:var(--ss-card-border)]"><div className={`absolute inset-0 px-5 py-3 ${isDisabled ? 'grayscale-[0.75] saturate-[0.35]' : ''}`}>{art}</div></div>
        <div className="flex flex-1 flex-col p-5">
          <h3 className="text-lg font-bold tracking-tight text-[color:var(--ss-text)]">{title}</h3>
          <p className="mt-0.5 text-sm font-semibold text-[color:var(--ss-card-btn)]">{promise}</p>
          <ul className="mt-3 space-y-2">
            {bullets.map((b) => (
              <li key={b.text} className="flex items-start gap-2 text-sm text-[color:var(--ss-text)]">
                <span aria-hidden className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-[5px] bg-[color:var(--ss-card-soft)] text-[color:var(--ss-card-btn)]"><b.Icon size={13} /></span>
                <span>{b.text}</span>
              </li>
            ))}
          </ul>
          <span className="mt-3.5 inline-flex w-fit items-center gap-1.5 rounded-md bg-[color:var(--ss-card-soft)] px-2.5 py-1 text-xs font-semibold text-[color:var(--ss-card-btn)]"><MarkerIcon size={13} aria-hidden /> {marker}</span>
          <button type="button" onClick={isDisabled ? undefined : onClick} disabled={isDisabled} data-testid={testid} aria-label={aria} className={ctaClass}>
            {label}{isDisabled ? null : <ArrowRight size={15} aria-hidden className="transition-transform group-hover:translate-x-0.5" />}
          </button>
        </div>
      </div>
      {/* Contextual notice — OUTSIDE the dimmed subtree, so full opacity, still inside the card + below CTA. */}
      {notice ? <div className="px-5 pb-5">{notice}</div> : null}
    </article>
  );
}

export default function PracticePage() {
  const navigate = useNavigate();
  const { setSurface } = usePracticeSurface();
  // #1042 PR4: Practice Home continuity — a NARROW read of the most-recent reviewable session (id /
  // created_at / duration / status only). Truthful empty state for new users; honest error state on
  // failure. Never fetches transcript, scores, or full history.
  const { data: recentSessions, isLoading: recentLoading, error: recentError } = useRecentPracticeSummary();
  const lastSession = recentSessions && recentSessions.length > 0 ? recentSessions[0] : null;
  // Guided is not a working product: selecting it shows an unavailable toast and marks the reporting
  // surface (it does NOT open a page/preview). `guidedSelected` only affects Report Issue attribution.
  const [guidedSelected, setGuidedSelected] = React.useState(false);
  // Once the user has acknowledged the unavailable Guided (first click), the Guided card renders in a
  // disabled state. LOCAL PAGE STATE ONLY: it survives a Quick→back round-trip within this /practice visit,
  // but a full reload / later visit resets it (showing the notice again). No storage/DB/profile.
  const [guidedAcknowledged, setGuidedAcknowledged] = React.useState(false);
  // The contextual notice shows on that first click and auto-hides after a few seconds; the disabled card
  // treatment remains regardless.
  const [guidedNoticeVisible, setGuidedNoticeVisible] = React.useState(false);
  const noticeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const returning = React.useRef(false);

  React.useEffect(() => {
    try {
      returning.current = localStorage.getItem('speaksharp_practice_seen') === '1';
      localStorage.setItem('speaksharp_practice_seen', '1');
    } catch { /* ignore storage errors */ }
    trackPracticeEntryViewed(returning.current);
  }, []);

  // Publish the active surface to the global Report Issue dialog (typed token only): a Guided (unavailable)
  // selection marks `guided_rehearsal_unavailable`; otherwise the chooser is home.
  React.useEffect(() => {
    const surface: PracticeSurface = guidedSelected ? 'guided_rehearsal_unavailable' : 'practice_home';
    setSurface(surface);
  }, [guidedSelected, setSurface]);

  // Reset the override when leaving /practice so a report elsewhere never inherits a stale surface, and
  // clear the notice timer on unmount.
  React.useEffect(() => () => { setSurface(null); if (noticeTimer.current) clearTimeout(noticeTimer.current); }, [setSurface]);

  // #1042 PR3: the Freestyle card navigates DIRECTLY to the working Session page — no intermediate
  // overview. It never auto-starts recording (SessionPage owns the mic). Truthful entry source is
  // 'landing_card' (never the removed 'quick_overview').
  const startFreestyle = () => { setGuidedSelected(false); trackPracticeModeSelected('quick', 'landing_card'); trackQuickPracticeStarted('landing_card'); navigate('/session'); };
  // Guided selected while UNAVAILABLE: stay on /practice, mark the reporting surface, and (ONCE) emit
  // content-free telemetry + show ONE contextual notice anchored to the Guided card, then disable the card.
  // No nav, no preview, no mic/AI/network/persistence, and NO global toast. The CTA becomes natively
  // disabled, so a repeat click cannot fire — the guard is a defensive belt against programmatic re-entry.
  const selectGuided = () => {
    setGuidedSelected(true);
    if (guidedAcknowledged) return;
    setGuidedAcknowledged(true);
    setGuidedNoticeVisible(true);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setGuidedNoticeVisible(false), 6000);
    trackPracticeModeSelected('guided', 'landing_card');
    trackGuidedRehearsalUnavailable();
  };

  return (
    // NOTE: no <main> / #main-content here — App.tsx owns the single page <main id="main-content">
    // landmark. Rendering another would create nested <main> elements and a duplicate id, breaking the
    // skip-link target and assistive-tech landmark navigation. This is a plain content container.
    <div className="practice-root ss-landing-canvas min-h-screen font-sans antialiased" data-testid="practice-root">
      <div className="practice-content">
        <>
            <div className="ss-theme-hero">
              {/* pt-24 keeps the chooser's content clear of the fixed global <nav> (h-16 / z-40). */}
              <div className="mx-auto max-w-5xl px-5 pb-14 pt-24 sm:px-8">
                <div className="mt-1 grid items-center gap-8 md:grid-cols-[1fr_22rem]">
                  <div>
                    {/* Split-color tagline: one phrase, two semantic spans — navy "Private Practice." +
                        saturated teal "Public Impact!" (same family/weight). Wraps naturally on mobile. */}
                    <h1 className="text-3xl font-extrabold tracking-tight sm:text-[2.6rem] sm:leading-[1.1]">
                      <span className="text-[color:var(--ss-text)]">Private Practice.</span>{' '}
                      <span className="text-[color:var(--ss-teal-title)]">Public Impact!</span>
                    </h1>
                    <span aria-hidden className="mt-3 block h-1.5 w-20 rounded-full" style={{ background: 'var(--ss-amber)' }} />
                    {/* Prominent orientation copy: weight-500 deep slate-blue, 20px mobile / 22px desktop,
                        with an intentional sentence break after "private." (kept as one paragraph for AT). */}
                    <p className="mt-4 max-w-xl text-[20px] font-medium leading-[1.5] text-[color:var(--ss-body-slate)] md:text-[22px]">Practice important speaking moments in private.<br />Get focused feedback and track your improvement before the moment matters.</p>
                    <p className="mt-5 inline-flex items-center gap-2 text-[17px] font-semibold text-[color:var(--ss-text)]"><span aria-hidden className="h-4 w-1 rounded-full" style={{ background: 'var(--ss-amber)' }} />Choose how you want to practice:</p>
                  </div>
                  {/* Enlarged hero graphic in a near-white panel (crisp border + controlled shadow, 10px radius)
                      so it reads as a meaningful product explanation. Desktop ~35-40% of hero width; mobile
                      ~240px, centered under the hero text (never a tiny floating icon). */}
                  <div className="mx-auto mt-5 w-[248px] rounded-[10px] border border-[color:var(--ss-border)] bg-white/75 p-3 shadow-[0_4px_16px_rgba(15,23,42,0.08)] md:mx-0 md:mt-0 md:w-full">
                    <div className="h-36 w-full md:h-56"><LandingHeroArt /></div>
                  </div>
                </div>
              </div>
            </div>

            {/* pb-28 below md clears the fixed mobile BOTTOM nav (Navigation.tsx: md:hidden fixed bottom-0,
                ~80px) plus safe-area, so the Guided CTA + contextual notice are never obscured. */}
            <div className="mx-auto -mt-6 max-w-5xl px-5 pb-28 [padding-bottom:calc(7rem+env(safe-area-inset-bottom))] md:pb-12 md:[padding-bottom:3rem] sm:px-8">
              {/* #1042 PR4: continuity for returning users (recent-session summary + Review/Analytics),
                  truthful empty state for new users. Sits above the two-product chooser. */}
              <PracticeContinuity
                loading={recentLoading}
                error={Boolean(recentError)}
                lastSession={lastSession}
                onReviewLast={() => { if (lastSession) navigate(`/analytics/${lastSession.id}`); }}
                onViewAnalytics={() => navigate('/analytics')}
              />
              <div className="grid grid-cols-1 items-stretch gap-7 md:grid-cols-2">
                <ModeCard vars={QUICK_VARS} art={<QuickPracticeArt />} title="Freestyle Practice" promise="Speak freely. See how you’re progressing."
                  bullets={QUICK_BULLETS}
                  marker="Available now" ctaLabel="Start Freestyle Practice" ctaAria="Start Freestyle Practice" ctaSolid onClick={startFreestyle} testid="practice-card-quick" />
                <ModeCard vars={GUIDED_VARS} art={<GuidedRehearsalArt />} title="Guided Rehearsal" promise="Prepare what matters. Rehearse until it lands."
                  bullets={GUIDED_BULLETS}
                  marker="Planned — not available yet" markerIcon={Clock} ctaLabel="Guided Rehearsal" ctaAria="Guided Rehearsal — not available yet"
                  disabled={guidedAcknowledged} ctaLabelDisabled="Unavailable" ctaAriaDisabled="Guided Rehearsal — unavailable"
                  notice={guidedNoticeVisible ? <GuidedUnavailableNotice /> : null}
                  onClick={selectGuided} testid="practice-card-guided" />
              </div>

              <p className="mt-6 text-center text-sm text-[color:var(--ss-text-secondary)]"><span className="font-semibold text-[color:var(--ss-text)]">Freestyle Practice</span> is available now — Guided Rehearsal is coming later.</p>
            </div>
        </>
      </div>
    </div>
  );
}
