/**
 * PracticePage — the ONE canonical, auth-aware Marketing + Product + Practice-Choices page (#1061).
 *
 * Rendered at `/` for ANONYMOUS visitors (marketing state: large hero, a free-trial strip, then the two
 * product cards) and at `/practice` for AUTHENTICATED users.
 *
 * #1047: the two states no longer share a layout. A visitor needs to be convinced; a signed-in user needs
 * to choose. The authenticated surface is therefore its own component (`AuthenticatedHome`) with no hero,
 * no tagline and no marketing bullets — see that file for why. This page keeps the shared identities
 * (Freeform teal / Objective violet), the routing, and the telemetry for BOTH states, so the two surfaces
 * cannot drift apart on what the buttons actually do.
 *
 * Both products are live. Open Mic navigates to the unchanged /session (authed) or through account
 * access preserving the /session intent (anonymous), never auto-starting recording. Focus Points (#1046
 * slice 5b) opens the capture form (ObjectiveSetupDialog) for authed users, binds the saved brief, and
 * routes into the session; anonymous users go through sign-up first (the brief RPCs require auth).
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Check,
  LineChart, Target, AudioLines, ListChecks, Repeat,
  type LucideIcon,
} from 'lucide-react';
import '@/styles/practice.css';
import { LandingHeroArt, FreeformArt, ObjectiveArt } from '@/components/practice/practiceArt';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { usePracticeSurface } from '@/components/practice/PracticeSurfaceContext';
import { AuthenticatedHome } from '@/components/practice/AuthenticatedHome';
import { PRODUCT_NAMES } from '@/constants/productNames';
import { useHomeStreak } from '@/components/practice/useHomeStreak';
import { ObjectiveSetupDialog } from '@/components/practice/ObjectiveSetupDialog';
import { useSessionStore } from '@/stores/useSessionStore';
import { useRecentPracticeSummary } from '@/hooks/useRecentPracticeSummary';
import type { PracticeSurface } from '@/services/pageContext';
import {
  trackPracticeEntryViewed, trackPracticeModeSelected,
  trackFreeformPracticeStarted,
} from '@/services/practiceTelemetry';

// Exact brand-teal ramp (spec): brand teal #0d7d74 for CTA fills / tagline / glyphs / border; header band is
// the two-stop 135° gradient #0d7d74→#17a99b (blue-leaning, NOT emerald/mint and NOT the dark CTA teal
// #0a5f58); icon/pill tint #e6f4f2. The waveform/transcript art reads WHITE on the dark teal band.
const FREEFORM_VARS: React.CSSProperties = {
  ['--ss-card' as string]: '#0d7d74', ['--ss-card-btn' as string]: '#0d7d74',
  ['--ss-card-soft' as string]: '#e6f4f2', ['--ss-card-panel' as string]: 'linear-gradient(135deg, #0d7d74 0%, #17a99b 100%)',
  ['--ss-card-border' as string]: '#0d7d74', ['--ss-card-warm' as string]: '#f4c77b',
  ['--ss-art-ink' as string]: 'rgba(255,255,255,0.9)',
};
// Objective violet — same 135° angle + light/dark relationship, violet tokens.
const OBJECTIVE_VARS: React.CSSProperties = {
  ['--ss-card' as string]: '#7b5ce0', ['--ss-card-btn' as string]: '#6a4fd0',
  ['--ss-card-soft' as string]: '#f0ecfb', ['--ss-card-panel' as string]: 'linear-gradient(135deg, #7b5ce0 0%, #9d7cf0 100%)',
  ['--ss-card-border' as string]: '#ded8f5', ['--ss-card-warm' as string]: 'var(--ss-coral)',
};

const FREEFORM_BULLETS: Bullet[] = [
  { text: 'No agenda or setup', Icon: Check },
  { text: 'Speak and see your live transcript', Icon: AudioLines },
  { text: 'Review fillers, delivery, and progress', Icon: LineChart },
];
const OBJECTIVE_BULLETS: Bullet[] = [
  { text: 'Prepare the points you need to cover', Icon: ListChecks },
  { text: 'See which points were detected — and what to retry', Icon: Target },
  { text: 'Rehearse corrections before the real moment', Icon: Repeat },
];

interface Bullet { text: string; Icon: LucideIcon }

function ModeCard({ vars, art, title, promise, bullets, ctaLabel, ctaAria, ctaSolid, ctaNote, onClick, testid, cornerBadge }: {
  vars: React.CSSProperties; art: React.ReactNode; title: string; promise: string; bullets: Bullet[];
  ctaLabel: string; ctaAria: string; ctaSolid?: boolean; ctaNote?: boolean; onClick: () => void; testid: string;
  cornerBadge?: string;
}) {
  // Full-width CTA pinned to the bottom so both product cards' buttons bottom-align.
  const ctaClass = `ss-ring flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-3 text-sm font-bold ${ctaSolid ? 'ss-accent-btn shadow-sm' : 'ss-accent-outline'}`;
  return (
    <article style={vars} data-testid={`${testid}-card`}
      className="group ss-mode-card flex h-full flex-col overflow-hidden rounded-[16px] bg-[color:var(--ss-surface)] transition-all duration-200 shadow-[0_6px_20px_rgba(15,23,42,0.10)] ring-[1.5px] ring-[color:var(--ss-card-border)] hover:-translate-y-0.5 hover:shadow-[0_10px_26px_rgba(15,23,42,0.14)] hover:ring-[color:var(--ss-card)]">
      <div className="flex flex-1 flex-col">
        <div className="ss-card-panel relative h-[4.75rem] border-b-2 border-[color:var(--ss-card-border)]">
          <div className="absolute inset-0 px-5 py-3">{art}</div>
          {cornerBadge && (
            <span
              data-testid="objective-soon-badge"
              style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(255,255,255,0.94)', color: '#6a4fd0', fontSize: 11, fontWeight: 800, padding: '5px 11px', borderRadius: 999, letterSpacing: '0.05em' }}
            >{cornerBadge}</span>
          )}
        </div>
        <div className="flex flex-1 flex-col p-5">
          <h3 className="text-[21px] font-extrabold tracking-tight text-[color:var(--ss-text)]">{title}</h3>
          <p className="mt-1 text-[15px] font-bold text-[color:var(--ss-card-btn)]">{promise}</p>
          <ul className="mt-3.5 space-y-2.5">
            {bullets.map((b) => (
              <li key={b.text} className="flex items-start gap-2.5 text-[15px] text-[color:var(--ss-body-slate,#3d4757)]">
                <span aria-hidden className="mt-px grid h-6 w-6 shrink-0 place-items-center rounded-[6px] bg-[color:var(--ss-card-soft)] text-[color:var(--ss-card-btn)]"><b.Icon size={14} /></span>
                <span>{b.text}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-1 flex-col justify-end pt-1">
            <button type="button" onClick={onClick} data-testid={testid} aria-label={ctaAria} className={ctaClass}>
              {ctaLabel}{ctaNote
                ? <span aria-hidden className="text-base leading-none">♪</span>
                : <ArrowRight size={15} aria-hidden className="transition-transform group-hover:translate-x-0.5" />}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

/** Freeform FREE TRIAL strip (anonymous only) — a compact promo above the product cards. It reuses the
 * SHARED Freeform teal token (`--ss-session-panel`) so the repeated color communicates that the trial
 * belongs to Freeform; it is deliberately smaller than the product card (promo vs. decision). The CTA
 * routes to Freeform (account access → /session, never auto-recording) and does not imply Private is
 * already active — it is a trial offer. */
function FreeformTrialStrip({ onStart }: { onStart: () => void }) {
  // DARK SLATE — deliberately NOT teal/violet: a neutral, system-level offer that gives the page its third
  // value step and (with the -mt overlap) kills the hard hero/page seam. Orange CTA uses near-black text
  // (never white on orange). The private-trial offer belongs to Freeform; the CTA routes to Freeform.
  return (
    <div
      data-testid="freeform-trial-strip"
      className="relative z-10 -mt-[26px] flex flex-col items-start gap-3 rounded-[13px] px-7 py-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4"
      style={{ background: '#1d4a45', boxShadow: '0 16px 34px -18px rgba(29,74,69,0.6)' }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide" style={{ background: '#f4c77b', color: '#6b3f08' }}>Free trial</span>
        <span className="text-[17px] font-bold text-white">Try a 5-minute private session — no card, no script.</span>
      </div>
      <button
        type="button"
        onClick={onStart}
        data-testid="freeform-trial-start"
        aria-label={"Start your session with a 5-minute Private trial"}
        className="ss-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold shadow-sm"
        style={{ background: '#d98a1f', color: '#241503' }}
      >
        Start your session<ArrowRight size={15} aria-hidden />
      </button>
    </div>
  );
}

export default function PracticePage() {
  const navigate = useNavigate();
  const { user } = useAuthProvider();
  const isAuthed = !!user;
  const { setSurface } = usePracticeSurface();
  // #1042 PR4: narrow recent-session read (authed only; the hook is disabled without a user).
  const { data: recentSessions, isLoading: recentLoading, error: recentError } = useRecentPracticeSummary();
  const lastSession = recentSessions && recentSessions.length > 0 ? recentSessions[0] : null;
  // #1093: the streak is now server-authoritative (get_practice_streak, #1098) — NOT the dead
  // check-usage-limit.streak_count and NOT a localStorage guess. Keyed by user id with stale-response
  // protection; the chip is always visible (loading → skeleton, else a settled label).
  const { streak: homeStreak, loading: homeStreakLoading } = useHomeStreak(user?.id ?? null);
  // Objective selection marks the Report Issue surface; the "Notify me" dialog is the real interest capture.
  const [objectiveSelected, setGuidedSelected] = React.useState(false);
  const [objectiveSetupOpen, setObjectiveSetupOpen] = React.useState(false);
  const returning = React.useRef(false);

  React.useEffect(() => {
    try {
      returning.current = localStorage.getItem('speaksharp_practice_seen') === '1';
      localStorage.setItem('speaksharp_practice_seen', '1');
    } catch { /* ignore storage errors */ }
    trackPracticeEntryViewed(returning.current);
  }, []);

  React.useEffect(() => {
    const surface: PracticeSurface = objectiveSelected ? 'objective_unavailable' : 'practice_home';
    setSurface(surface);
  }, [objectiveSelected, setSurface]);

  React.useEffect(() => () => { setSurface(null); }, [setSurface]);

  // Freeform: authed → /session directly; anonymous → account access preserving the /session intent via
  // location.state.from (resolvePostAuthPath honors safe deep-links). Never auto-starts recording.
  const startFreeform = () => {
    setGuidedSelected(false);
    trackPracticeModeSelected('quick', 'landing_card');
    trackFreeformPracticeStarted('landing_card');
    if (isAuthed) navigate('/session');
    else navigate('/auth/signup', { state: { from: { pathname: '/session' } } });
  };

  // #1047 anonymous handoff: the "Try a 5-minute private session" band promises Private, so it must
  // carry that intent to /session — surviving signup/login via `location.state.from.search`, which
  // `resolvePostAuthPath` preserves. /session honours `?trial=private` by PRESELECTING Private only
  // when the account is eligible (never a silent Browser fallback, never auto-record/auto-download);
  // an ineligible account is told truthfully and stays on Browser.
  const startPrivateTrial = () => {
    setGuidedSelected(false);
    trackPracticeModeSelected('quick', 'landing_card');
    trackFreeformPracticeStarted('landing_card');
    if (isAuthed) navigate('/session?trial=private');
    else navigate('/auth/signup', { state: { from: { pathname: '/session', search: '?trial=private' } } });
  };

  // #1046 slice 5b: Focus Points is ACTIVATED. Authed users set their points in a modal, then route
  // into the session; anonymous users go to sign-up first (the brief RPCs require auth). Content-free
  // telemetry only.
  const startObjective = () => {
    trackPracticeModeSelected('objective', 'landing_card');
    if (isAuthed) {
      setObjectiveSetupOpen(true);
    } else {
      navigate('/auth/signup', { state: { from: { pathname: '/practice' } } });
    }
  };

  // A saved brief binds to the store and routes into the session; the stop seam then finalizes per-point
  // coverage (slice 5a). setActiveObjectiveBrief is CONSUMED at the stop seam, so binding here is safe.
  const handleObjectiveReady = ({ briefId, projectId, points, topic, paceGuideSecPerPoint }: { briefId: string; projectId: string; points: string[]; topic: string; paceGuideSecPerPoint: number | null }) => {
    useSessionStore.getState().setActiveObjectiveBrief({ projectId, briefId, points, topic, paceGuideSecPerPoint });
    setObjectiveSetupOpen(false);
    navigate('/session');
  };

  const freestyleCard = (
    <ModeCard vars={FREEFORM_VARS} art={<FreeformArt />} title={PRODUCT_NAMES.freeform}
      promise="No script. No pressure. Just practice."
      bullets={FREEFORM_BULLETS}
      ctaLabel={"Start your session"} ctaAria={"Start your session"}
      ctaSolid onClick={startFreeform} testid="practice-card-freeform" />
  );
  const guidedCard = (
    <ModeCard vars={OBJECTIVE_VARS} art={<ObjectiveArt />} title={PRODUCT_NAMES.objective}
      promise="Prepare the points that must land."
      bullets={OBJECTIVE_BULLETS}
      ctaLabel="Start your session" ctaAria={`Start ${PRODUCT_NAMES.objective}`}
      ctaSolid onClick={startObjective} testid="practice-card-objective" />
  );
  const productGrid = (
    <div className="grid grid-cols-1 items-stretch gap-7 md:grid-cols-2">{freestyleCard}{guidedCard}</div>
  );

  /* #1047 AUTHENTICATED product state — an entirely separate surface. The user has already converted,
     so there is no hero, no tagline and no marketing copy: a question, and two answers. */
  const authenticatedHome = (
    <AuthenticatedHome
      lastSession={lastSession}
      recentLoading={recentLoading}
      recentFailed={Boolean(recentError)}
      streak={homeStreak}
      streakLoading={homeStreakLoading}
      onStartFreeform={startFreeform}
      onStartObjective={startObjective}
      onReviewLastSession={() => { if (lastSession) navigate(`/analytics/${lastSession.id}`); }}
      onViewAnalytics={() => navigate('/analytics')}
    />
  );

  if (isAuthed) {
    return (
      // App.tsx owns the single <main id="main-content"> landmark; this is a plain content container.
      <div className="practice-root ss-landing-canvas min-h-screen font-sans antialiased" data-testid="practice-root">
        <div className="practice-content">{authenticatedHome}</div>
        <ObjectiveSetupDialog
          open={objectiveSetupOpen}
          onOpenChange={setObjectiveSetupOpen}
          onReady={handleObjectiveReady}
        />
      </div>
    );
  }

  return (
    // App.tsx owns the single <main id="main-content"> landmark; this is a plain content container.
    <div className="practice-root ss-landing-canvas min-h-screen font-sans antialiased" data-testid="practice-root">
      <div className="practice-content">
        {/* ANONYMOUS marketing state — large sales hero. */}
        <div className="ss-theme-hero">
            <div className="mx-auto max-w-5xl px-5 pb-10 pt-24 sm:px-8">
              <div className="mt-1 grid items-start gap-8 md:grid-cols-[1fr_22rem]">
                <div>
                  <h1 className="font-extrabold" style={{ fontSize: 'clamp(38px, 8.5vw, 54px)', lineHeight: 1.02, fontWeight: 800, letterSpacing: '-0.035em' }}>
                    <span className="text-[color:var(--ss-text)]">Private Practice.</span>
                    <br />
                    <span style={{ color: '#0a5f58' }}>Public Impact.</span>
                  </h1>
                  <span aria-hidden className="mt-3 block h-1.5 w-20 rounded-full" style={{ background: 'var(--ss-amber)' }} />
                  <p className="mt-4 text-[19px] font-semibold leading-[1.5]" style={{ color: '#14181f', maxWidth: '470px' }}>Practice important speaking moments in private. Get focused feedback and track your improvement before the moment matters.</p>
                  <div className="mt-6">
                    {/* Teal CTA on the orange field — complementary contrast (Rule 2). White text on teal. */}
                    <button
                      type="button"
                      onClick={() => navigate('/auth/signup')}
                      data-testid="practice-hero-start-free"
                      className="ss-ring inline-flex items-center gap-2 rounded-[11px] px-7 py-3.5 text-[17px] font-bold text-white shadow-[0_14px_28px_-12px_rgba(10,95,88,0.85)]"
                      style={{ background: '#0a5f58' }}
                    >
                      Start free<ArrowRight className="size-5" aria-hidden />
                    </button>
                  </div>
                </div>
                <div className="mx-auto mt-5 w-[248px] rounded-[10px] border border-[color:var(--ss-border)] bg-white/75 p-3 shadow-[0_4px_16px_rgba(15,23,42,0.08)] md:mx-0 md:mt-0 md:w-full">
                  <div className="h-36 w-full md:h-56"><LandingHeroArt /></div>
                </div>
              </div>
            </div>
          </div>

        {/* ANONYMOUS: a compact Freeform FREE TRIAL strip (shared Freeform teal token) directly above
            the two product cards. The strip carries the trial promo; each product card owns its decision
            + action. No four-card support section. */}
        <div className="mx-auto mt-0 max-w-[1120px] px-5 pb-28 [padding-bottom:calc(7rem+env(safe-area-inset-bottom))] sm:px-10 md:pb-12 md:[padding-bottom:3rem]">
          <FreeformTrialStrip onStart={startPrivateTrial} />
          <div className="mb-6 mt-11 flex flex-col items-center text-center" data-testid="practice-support-heading">
            {/* Filled pill eyebrow (Rule 6) — small teal text on light grey would disappear. */}
            <span className="inline-flex items-center rounded-full px-4 py-2 text-[13px] font-extrabold uppercase tracking-[0.1em] text-white" style={{ background: '#0a5f58' }}>How it helps</span>
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-[color:var(--ss-text)] sm:text-[32px]">Choose the support your moment needs.</h2>
          </div>
          {productGrid}
        </div>
      </div>
    </div>
  );
}
