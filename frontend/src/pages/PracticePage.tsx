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
  LineChart, Target, AudioLines, ListChecks, Repeat, Sparkles, Bell,
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

/** A compact, visually SUBORDINATE supporting card: an eyebrow + ONE pithy line (+ a bottom-aligned action
 * on CTA cards). flex-column with the action pinned to the bottom (mt-auto) so buttons share a baseline; the
 * card stretches to equal height within its grid row (no fragile fixed heights that could clip long text). */
function SupportCard({ vars, eyebrow, line, action, testid }: {
  vars: React.CSSProperties; eyebrow: string; line: string; action?: React.ReactNode; testid: string;
}) {
  return (
    <div style={vars} data-testid={testid}
      className="flex h-full min-h-[7.5rem] flex-col rounded-[10px] border border-[color:var(--ss-border)] bg-white/80 p-4 shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
      <span className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--ss-card-btn)]">{eyebrow}</span>
      <p className="mt-1.5 text-[15px] font-bold leading-snug text-[color:var(--ss-text)]">{line}</p>
      {action ? <div className="mt-auto pt-3">{action}</div> : null}
    </div>
  );
}

/** Decorative connector — two curves converging from the pair of support cards down onto the product card.
 * aria-hidden: the product relationship is ALSO encoded structurally (grouped <section> + heading), so the
 * meaning never depends on the arrows or on color. Colored to the product identity. */
function GroupConnector({ stroke }: { stroke: string }) {
  return (
    <svg aria-hidden viewBox="0 0 320 40" className="h-6 w-full" preserveAspectRatio="none">
      <path d="M70 2 C 70 26, 160 20, 160 38" fill="none" stroke={stroke} strokeWidth="2.5" strokeOpacity="0.7" strokeLinecap="round" />
      <path d="M250 2 C 250 26, 160 20, 160 38" fill="none" stroke={stroke} strokeWidth="2.5" strokeOpacity="0.7" strokeLinecap="round" />
      <path d="M154 32 l6 7 l6 -7" fill="none" stroke={stroke} strokeWidth="2.5" strokeOpacity="0.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
      ctaSolid onClick={startFreestyle} testid="practice-card-quick" hideCta={!isAuthed} />
  );
  const guidedCard = (
    <ModeCard vars={GUIDED_VARS} art={<GuidedRehearsalArt />} title="Guided Rehearsal" promise="Prepare what matters. Rehearse until it lands."
      bullets={GUIDED_BULLETS} marker="Coming Soon!" markerIcon={Clock} ctaLabel="Notify me" ctaAria="Notify me about Guided Rehearsal"
      onClick={openNotify} testid="practice-card-guided" hideCta={!isAuthed} />
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
              <div className="grid grid-cols-1 items-stretch gap-7 md:grid-cols-2">
                {freestyleCard}
                {guidedCard}
              </div>
            </>
          ) : (
            /* ANONYMOUS: a "how it helps" support section — two PRODUCT GROUPS, each with an explanation card,
               a CTA card, curved connectors, and the product card. Semantic grouping (not arrows/color)
               carries the relationship. */
            <section aria-label="Choose the support your moment needs" data-testid="practice-support">
              <div className="mb-6 text-center">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[color:var(--ss-card-btn,#08746F)]"><Sparkles size={13} aria-hidden /> How it helps</span>
                <h2 className="mt-1 text-2xl font-bold tracking-tight text-[color:var(--ss-text)] sm:text-3xl">Choose the support your moment needs.</h2>
              </div>

              {/* One grid: on mobile the cells flow in SOURCE order (Freestyle group, then Guided group).
                  On md+, explicit row/col placement puts the two support rows in the SAME grid row (1fr →
                  equal height) so the connectors and BOTH product cards land on the same baseline. */}
              <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2 md:[grid-template-rows:1fr_auto_1fr]">
                {/* Freestyle: support (r1c1) → connector (r2c1) → product (r3c1) */}
                <div role="group" aria-label="Freestyle Practice options" data-testid="practice-group-freestyle"
                  className="grid grid-cols-2 items-stretch gap-3 md:col-start-1 md:row-start-1">
                  <SupportCard vars={QUICK_VARS} eyebrow="Why Freestyle" line="No script. No pressure. Just practice." testid="support-freestyle-explain" />
                  <SupportCard vars={QUICK_VARS} eyebrow="Try Private" line="5-minute Private trial" testid="support-freestyle-cta"
                    action={<button type="button" onClick={startFreestyle} data-testid="support-freestyle-start" aria-label="Start Freestyle Practice with a 5-minute Private trial" className="ss-ring ss-accent-btn inline-flex w-fit items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm">Start Freestyle<ArrowRight size={15} aria-hidden /></button>} />
                </div>
                <div aria-hidden className="md:col-start-1 md:row-start-2"><GroupConnector stroke="var(--ss-session-accent)" /></div>
                <div className="h-full md:col-start-1 md:row-start-3">{freestyleCard}</div>

                {/* Guided: support (r1c2) → connector (r2c2) → product (r3c2) */}
                <div role="group" aria-label="Guided Rehearsal options" data-testid="practice-group-guided"
                  className="mt-3 grid grid-cols-2 items-stretch gap-3 md:col-start-2 md:row-start-1 md:mt-0">
                  <SupportCard vars={GUIDED_VARS} eyebrow="Why Guided" line="Prepare the points that must land." testid="support-guided-explain" />
                  <SupportCard vars={GUIDED_VARS} eyebrow="Stay in the loop" line="Want launch updates? Get notified." testid="support-guided-cta"
                    action={<button type="button" onClick={openNotify} data-testid="support-guided-notify" className="ss-ring ss-accent-outline inline-flex w-fit items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold">Notify me<Bell size={15} aria-hidden /></button>} />
                </div>
                <div aria-hidden className="md:col-start-2 md:row-start-2"><GroupConnector stroke="var(--ss-exec-accent)" /></div>
                <div className="h-full md:col-start-2 md:row-start-3">{guidedCard}</div>
              </div>
            </section>
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
