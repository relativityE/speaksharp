/**
 * PracticePage — the ONE canonical, auth-aware Marketing + Product + Practice-Choices page (#1061).
 *
 * Rendered at `/` for ANONYMOUS visitors (marketing state: large hero, a "how it helps" support section with
 * four cards + curved connectors, then the two product cards) and at `/practice` for AUTHENTICATED users
 * (product state: compact welcome, recent-practice continuity, then the two product cards). Both states share
 * ONE page/component, the same visual tokens, the same product-card implementation, and the same Freestyle
 * (teal) / Guided (purple) identities. Authentication changes the intro, supporting content, and actions.
 *
 * Freestyle Practice is the only working product; its action navigates to the unchanged /session (authed) or
 * through account access preserving /session intent (anonymous), and never auto-starts recording. Guided
 * Rehearsal is "Coming Soon!" with a real "Notify me" pre-launch interest capture (GuidedNotifyDialog).
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Check,
  LineChart, Target, AudioLines, ListChecks, Repeat,
  type LucideIcon,
} from 'lucide-react';
import '@/styles/practice.css';
import { LandingHeroArt, QuickPracticeArt, GuidedRehearsalArt } from '@/components/practice/practiceArt';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { usePracticeSurface } from '@/components/practice/PracticeSurfaceContext';
import { PracticeContinuity } from '@/components/practice/PracticeContinuity';
import { GuidedNotifyDialog } from '@/components/practice/GuidedNotifyDialog';
import { GUIDED_WAITLIST_ENABLED } from '@/config/env';
import { useRecentPracticeSummary } from '@/hooks/useRecentPracticeSummary';
import type { PracticeSurface } from '@/services/pageContext';
import {
  trackPracticeEntryViewed, trackPracticeModeSelected,
  trackQuickPracticeStarted, trackGuidedRehearsalUnavailable,
} from '@/services/practiceTelemetry';

// Exact brand-teal ramp (spec): brand teal #0d7d74 for CTA fills / tagline / glyphs / border; header band is
// the two-stop 135° gradient #0d7d74→#17a99b (blue-leaning, NOT emerald/mint and NOT the dark CTA teal
// #0a5f58); icon/pill tint #e6f4f2. The waveform/transcript art reads WHITE on the dark teal band.
const QUICK_VARS: React.CSSProperties = {
  ['--ss-card' as string]: '#0d7d74', ['--ss-card-btn' as string]: '#0d7d74',
  ['--ss-card-soft' as string]: '#e6f4f2', ['--ss-card-panel' as string]: 'linear-gradient(135deg, #0d7d74 0%, #17a99b 100%)',
  ['--ss-card-border' as string]: '#0d7d74', ['--ss-card-warm' as string]: '#f4c77b',
  ['--ss-art-ink' as string]: 'rgba(255,255,255,0.9)',
};
// Guided violet — same 135° angle + light/dark relationship, violet tokens.
const GUIDED_VARS: React.CSSProperties = {
  ['--ss-card' as string]: '#7b5ce0', ['--ss-card-btn' as string]: '#6a4fd0',
  ['--ss-card-soft' as string]: '#f0ecfb', ['--ss-card-panel' as string]: 'linear-gradient(135deg, #7b5ce0 0%, #9d7cf0 100%)',
  ['--ss-card-border' as string]: '#ded8f5', ['--ss-card-warm' as string]: 'var(--ss-coral)',
};

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
              data-testid="guided-soon-badge"
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

/** Freestyle FREE TRIAL strip (anonymous only) — a compact promo above the product cards. It reuses the
 * SHARED Freestyle teal token (`--ss-session-panel`) so the repeated color communicates that the trial
 * belongs to Freestyle; it is deliberately smaller than the product card (promo vs. decision). The CTA
 * routes to Freestyle (account access → /session, never auto-recording) and does not imply Private is
 * already active — it is a trial offer. */
function FreestyleTrialStrip({ onStart }: { onStart: () => void }) {
  // DARK SLATE — deliberately NOT teal/violet: a neutral, system-level offer that gives the page its third
  // value step and (with the -mt overlap) kills the hard hero/page seam. Orange CTA uses near-black text
  // (never white on orange). The private-trial offer belongs to Freestyle; the CTA routes to Freestyle.
  return (
    <div
      data-testid="freestyle-trial-strip"
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
        data-testid="freestyle-trial-start"
        aria-label="Start Freestyle Practice with a 5-minute Private trial"
        className="ss-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold shadow-sm"
        style={{ background: '#d98a1f', color: '#241503' }}
      >
        Start Freestyle<ArrowRight size={15} aria-hidden />
      </button>
    </div>
  );
}

export default function PracticePage() {
  const navigate = useNavigate();
  const { user } = useAuthProvider();
  const isAuthed = !!user;
  const accountEmail = (user as { email?: string } | null | undefined)?.email ?? '';
  const { setSurface } = usePracticeSurface();
  // #1042 PR4: narrow recent-session read (authed only; the hook is disabled without a user).
  const { data: recentSessions, isLoading: recentLoading, error: recentError } = useRecentPracticeSummary();
  const lastSession = recentSessions && recentSessions.length > 0 ? recentSessions[0] : null;
  // Guided selection marks the Report Issue surface; the "Notify me" dialog is the real interest capture.
  const [guidedSelected, setGuidedSelected] = React.useState(false);
  const [notifyOpen, setNotifyOpen] = React.useState(false);
  const returning = React.useRef(false);

  React.useEffect(() => {
    try {
      returning.current = localStorage.getItem('speaksharp_practice_seen') === '1';
      localStorage.setItem('speaksharp_practice_seen', '1');
    } catch { /* ignore storage errors */ }
    trackPracticeEntryViewed(returning.current);
  }, []);

  React.useEffect(() => {
    const surface: PracticeSurface = guidedSelected ? 'guided_rehearsal_unavailable' : 'practice_home';
    setSurface(surface);
  }, [guidedSelected, setSurface]);

  React.useEffect(() => () => { setSurface(null); }, [setSurface]);

  // Freestyle: authed → /session directly; anonymous → account access preserving the /session intent via
  // location.state.from (resolvePostAuthPath honors safe deep-links). Never auto-starts recording.
  const startFreestyle = () => {
    setGuidedSelected(false);
    trackPracticeModeSelected('quick', 'landing_card');
    trackQuickPracticeStarted('landing_card');
    if (isAuthed) navigate('/session');
    else navigate('/auth/signup', { state: { from: { pathname: '/session' } } });
  };

  // Guided "Notify me": open the real pre-launch interest dialog; content-free telemetry only. No nav.
  const openNotify = () => {
    setGuidedSelected(true);
    trackPracticeModeSelected('guided', 'landing_card');
    trackGuidedRehearsalUnavailable();
    setNotifyOpen(true);
  };

  const freestyleCard = (
    <ModeCard vars={QUICK_VARS} art={<QuickPracticeArt />} title="Freestyle Practice"
      promise={isAuthed ? 'Speak freely. See how you’re progressing.' : 'No script. No pressure. Just practice.'}
      bullets={QUICK_BULLETS}
      ctaLabel={isAuthed ? 'Start Freestyle Practice' : 'Start Freestyle'} ctaAria="Start Freestyle Practice"
      ctaSolid onClick={startFreestyle} testid="practice-card-quick" />
  );
  const guidedCard = (
    <ModeCard vars={GUIDED_VARS} art={<GuidedRehearsalArt />} title="Guided Rehearsal"
      promise={isAuthed ? 'Prepare what matters. Rehearse until it lands.' : 'Prepare the points that must land.'}
      bullets={GUIDED_BULLETS} cornerBadge="SOON"
      ctaLabel="Notify me at launch" ctaNote ctaAria="Notify me about Guided Rehearsal"
      onClick={openNotify} testid="practice-card-guided" />
  );
  const productGrid = (
    <div className="grid grid-cols-1 items-stretch gap-7 md:grid-cols-2">{freestyleCard}{guidedCard}</div>
  );

  return (
    // App.tsx owns the single <main id="main-content"> landmark; this is a plain content container.
    <div className="practice-root ss-landing-canvas min-h-screen font-sans antialiased" data-testid="practice-root">
      <div className="practice-content">
        {isAuthed ? (
          /* AUTHENTICATED product state — a greeting ROW (visibly logged-in), NO marketing peach band: the
             product choices lead the page. Recent-practice continuity sits inline on the right. */
          <div className="mx-auto max-w-5xl px-5 pb-3 pt-24 sm:px-8" data-testid="practice-welcome-authed">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <span className="text-[13px] font-extrabold uppercase tracking-[0.1em] text-[color:var(--ss-teal-title)]">Welcome back</span>
                <h1 className="mt-1 text-[30px] font-extrabold tracking-tight text-[color:var(--ss-text)] sm:text-[38px]">What would you like to practice?</h1>
              </div>
              <PracticeContinuity
                variant="inline"
                loading={recentLoading}
                error={Boolean(recentError)}
                lastSession={lastSession}
                onReviewLast={() => { if (lastSession) navigate(`/analytics/${lastSession.id}`); }}
                onViewAnalytics={() => navigate('/analytics')}
              />
            </div>
          </div>
        ) : (
          /* ANONYMOUS marketing state — large sales hero. */
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
        )}

        <div className={`mx-auto max-w-[1120px] px-5 pb-28 [padding-bottom:calc(7rem+env(safe-area-inset-bottom))] md:pb-12 md:[padding-bottom:3rem] sm:px-10 ${isAuthed ? 'mt-4' : 'mt-0'}`}>
          {isAuthed ? (
            /* AUTHENTICATED: the two product cards (each owns its action). Continuity is in the greeting row. */
            productGrid
          ) : (
            /* ANONYMOUS: a compact Freestyle FREE TRIAL strip (shared Freestyle teal token) directly above
               the two product cards. The strip carries the trial promo; each product card owns its decision
               + action. No four-card support section. */
            <>
              <FreestyleTrialStrip onStart={startFreestyle} />
              <div className="mb-6 mt-11 flex flex-col items-center text-center" data-testid="practice-support-heading">
                {/* Filled pill eyebrow (Rule 6) — small teal text on light grey would disappear. */}
                <span className="inline-flex items-center rounded-full px-4 py-2 text-[13px] font-extrabold uppercase tracking-[0.1em] text-white" style={{ background: '#0a5f58' }}>How it helps</span>
                <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-[color:var(--ss-text)] sm:text-[32px]">Choose the support your moment needs.</h2>
              </div>
              {productGrid}
            </>
          )}
        </div>
      </div>

      <GuidedNotifyDialog
        open={notifyOpen}
        onOpenChange={setNotifyOpen}
        source={isAuthed ? 'authenticated_practice' : 'anonymous_landing'}
        defaultEmail={isAuthed ? accountEmail : ''}
        enabled={GUIDED_WAITLIST_ENABLED}
      />
    </div>
  );
}
