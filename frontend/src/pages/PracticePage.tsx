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
  ArrowRight, Check, Clock,
  LineChart, Target, AudioLines, ListChecks, Repeat,
  type LucideIcon,
} from 'lucide-react';
import '@/styles/practice.css';
import { LandingHeroArt, QuickPracticeArt, GuidedRehearsalArt } from '@/components/practice/practiceArt';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { usePracticeSurface } from '@/components/practice/PracticeSurfaceContext';
import { PracticeContinuity } from '@/components/practice/PracticeContinuity';
import { GuidedNotifyDialog } from '@/components/practice/GuidedNotifyDialog';
import { useRecentPracticeSummary } from '@/hooks/useRecentPracticeSummary';
import { Button } from '@/components/ui/button';
import type { PracticeSurface } from '@/services/pageContext';
import {
  trackPracticeEntryViewed, trackPracticeModeSelected,
  trackQuickPracticeStarted, trackGuidedRehearsalUnavailable,
} from '@/services/practiceTelemetry';

const QUICK_VARS: React.CSSProperties = {
  ['--ss-card' as string]: 'var(--ss-session-accent)', ['--ss-card-btn' as string]: 'var(--ss-session-btn)',
  ['--ss-card-soft' as string]: 'var(--ss-session-soft)', ['--ss-card-panel' as string]: 'var(--ss-session-panel)',
  ['--ss-card-border' as string]: 'var(--ss-session-border)', ['--ss-card-warm' as string]: 'var(--ss-sun)',
  ['--ss-art-ink' as string]: '#065E5A',
};
const GUIDED_VARS: React.CSSProperties = {
  ['--ss-card' as string]: 'var(--ss-exec-accent)', ['--ss-card-btn' as string]: 'var(--ss-exec-btn)',
  ['--ss-card-soft' as string]: 'var(--ss-exec-soft)', ['--ss-card-panel' as string]: 'var(--ss-exec-panel)',
  ['--ss-card-border' as string]: 'var(--ss-exec-border)', ['--ss-card-warm' as string]: 'var(--ss-coral)',
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

function ModeCard({ vars, art, title, promise, bullets, marker, markerIcon, ctaLabel, ctaAria, ctaSolid, onClick, testid, hideCta }: {
  vars: React.CSSProperties; art: React.ReactNode; title: string; promise: string; bullets: Bullet[];
  marker: string; markerIcon?: LucideIcon; ctaLabel: string; ctaAria: string; ctaSolid?: boolean; onClick: () => void; testid: string;
  // #1061: on the anonymous landing the supporting CTA card owns the action, so the product card renders
  // WITHOUT a duplicate button (one clear primary action per product group).
  hideCta?: boolean;
}) {
  const MarkerIcon = markerIcon ?? Check;
  const ctaClass = `ss-ring mt-4 inline-flex w-fit items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold ${ctaSolid ? 'ss-accent-btn shadow-sm' : 'ss-accent-outline'}`;
  return (
    <article style={vars} data-testid={`${testid}-card`}
      className="group ss-mode-card flex h-full flex-col overflow-hidden rounded-[10px] bg-[color:var(--ss-surface)] transition-all duration-200 shadow-[0_6px_20px_rgba(15,23,42,0.10)] ring-2 ring-[color:var(--ss-card-border)] hover:-translate-y-0.5 hover:shadow-[0_10px_26px_rgba(15,23,42,0.14)] hover:ring-[color:var(--ss-card)]">
      <div className="flex flex-1 flex-col">
        <div className="ss-card-panel relative h-[4.75rem] border-b-2 border-[color:var(--ss-card-border)]"><div className="absolute inset-0 px-5 py-3">{art}</div></div>
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
          {hideCta ? null : (
            <button type="button" onClick={onClick} data-testid={testid} aria-label={ctaAria} className={ctaClass}>
              {ctaLabel}<ArrowRight size={15} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
            </button>
          )}
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
  return (
    <div
      data-testid="freestyle-trial-strip"
      className="flex flex-col items-start gap-3 rounded-[12px] p-4 shadow-[0_6px_18px_rgba(15,23,42,0.12)] sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5"
      style={{ background: 'var(--ss-session-panel)' }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="rounded-full bg-white/25 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">Free trial</span>
        <span className="text-[15px] font-semibold text-white">Try Private for 5 minutes—no credit card required.</span>
      </div>
      <button
        type="button"
        onClick={onStart}
        data-testid="freestyle-trial-start"
        aria-label="Start Freestyle Practice with a 5-minute Private trial"
        className="ss-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ss-session-btn,#08746F)] shadow-sm"
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
    <ModeCard vars={QUICK_VARS} art={<QuickPracticeArt />} title="Freestyle Practice" promise="Speak freely. See how you’re progressing."
      bullets={QUICK_BULLETS} marker="Available now" ctaLabel="Start Freestyle Practice" ctaAria="Start Freestyle Practice"
      ctaSolid onClick={startFreestyle} testid="practice-card-quick" />
  );
  const guidedCard = (
    <ModeCard vars={GUIDED_VARS} art={<GuidedRehearsalArt />} title="Guided Rehearsal" promise="Prepare what matters. Rehearse until it lands."
      bullets={GUIDED_BULLETS} marker="Coming Soon!" markerIcon={Clock} ctaLabel="Notify me" ctaAria="Notify me about Guided Rehearsal"
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
          /* AUTHENTICATED product state — compact welcome (visibly logged-in), not the marketing hero. */
          <div className="ss-theme-hero">
            <div className="mx-auto max-w-5xl px-5 pb-6 pt-24 sm:px-8" data-testid="practice-welcome-authed">
              <p className="text-lg font-extrabold tracking-tight sm:text-xl">
                <span className="text-[color:var(--ss-text)]">Private Practice.</span>{' '}
                <span className="text-[color:var(--ss-teal-title)]">Public Impact!</span>
              </p>
              <p className="mt-2 text-2xl font-bold italic text-[color:var(--ss-teal-title)] sm:text-[1.7rem]">Let’s get started! Select what you want to do.</p>
            </div>
          </div>
        ) : (
          /* ANONYMOUS marketing state — large sales hero. */
          <div className="ss-theme-hero">
            <div className="mx-auto max-w-5xl px-5 pb-10 pt-24 sm:px-8">
              <div className="mt-1 grid items-center gap-8 md:grid-cols-[1fr_22rem]">
                <div>
                  <h1 className="font-extrabold leading-[1.05] tracking-tight" style={{ fontSize: 'clamp(44px, 6.2vw, 88px)' }}>
                    <span className="text-[color:var(--ss-text)]">Private Practice.</span>
                    <br />
                    <span className="text-[color:var(--ss-teal-title)]">Public Impact!</span>
                  </h1>
                  <span aria-hidden className="mt-3 block h-1.5 w-20 rounded-full" style={{ background: 'var(--ss-amber)' }} />
                  <p className="mt-4 max-w-xl text-[20px] font-medium leading-[1.5] text-[color:var(--ss-body-slate)] md:text-[22px]">Practice important speaking moments in private.<br />Get focused feedback and track your improvement before the moment matters.</p>
                  <div className="mt-6">
                    <Button size="lg" className="h-13 px-6 text-base" onClick={() => navigate('/auth/signup')} data-testid="practice-hero-start-free">
                      Start free<ArrowRight className="ml-2 size-5" aria-hidden />
                    </Button>
                  </div>
                </div>
                <div className="mx-auto mt-5 w-[248px] rounded-[10px] border border-[color:var(--ss-border)] bg-white/75 p-3 shadow-[0_4px_16px_rgba(15,23,42,0.08)] md:mx-0 md:mt-0 md:w-full">
                  <div className="h-36 w-full md:h-56"><LandingHeroArt /></div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mx-auto -mt-6 max-w-5xl px-5 pb-28 [padding-bottom:calc(7rem+env(safe-area-inset-bottom))] md:pb-12 md:[padding-bottom:3rem] sm:px-8">
          {isAuthed ? (
            /* AUTHENTICATED: continuity + product cards (each card owns its own action). */
            <>
              <PracticeContinuity
                loading={recentLoading}
                error={Boolean(recentError)}
                lastSession={lastSession}
                onReviewLast={() => { if (lastSession) navigate(`/analytics/${lastSession.id}`); }}
                onViewAnalytics={() => navigate('/analytics')}
              />
              {productGrid}
            </>
          ) : (
            /* ANONYMOUS: a compact Freestyle FREE TRIAL strip (shared Freestyle teal token) directly above
               the two product cards. The strip carries the trial promo; each product card owns its decision
               + action. No four-card support section. */
            <>
              <FreestyleTrialStrip onStart={startFreestyle} />
              <div className="mb-6 mt-8 text-center" data-testid="practice-support-heading">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--ss-card-btn,#08746F)]">How it helps</span>
                <h2 className="mt-1 text-2xl font-bold tracking-tight text-[color:var(--ss-text)] sm:text-3xl">Choose the support your moment needs.</h2>
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
      />
    </div>
  );
}
