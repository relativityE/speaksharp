/**
 * PracticePage — the ONE canonical, auth-aware Marketing + Product + Practice-Choices page (#1061).
 *
 * Rendered at `/` for ANONYMOUS visitors (the #1475 G12 homepage) and at `/practice` for AUTHENTICATED users.
 *
 * #1047: the two states no longer share a layout. A visitor needs to be convinced; a signed-in user needs
 * to choose. The authenticated surface is therefore its own component (`AuthenticatedHome`) with no hero,
 * no tagline and no marketing bullets — see that file for why. This page keeps the routing and the telemetry
 * for BOTH states, so the two surfaces cannot drift apart on what the buttons actually do.
 *
 * #1475: the anonymous state is the approved G12 homepage — full-bleed ink hero with the complete offer,
 * the two product entries, the Practice Loop, sequential pricing, and a closing CTA. Every signup decision
 * point states the complete offer (#1470).
 *
 * Both products are live. Open Mic navigates to the unchanged /session (authed) or through account
 * access preserving the /session intent (anonymous), never auto-starting recording. Focus Points (#1046
 * slice 5b) opens the capture form (ObjectiveSetupDialog) for authed users, binds the saved brief, and
 * routes into the session; anonymous users go through sign-up first (the brief RPCs require auth).
 */

import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useIsPresent } from 'framer-motion';
import '@/styles/practice.css';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { usePracticeSurface } from '@/components/practice/PracticeSurfaceContext';
import { AuthenticatedHome } from '@/components/practice/AuthenticatedHome';
import { useHomeStreak } from '@/components/practice/useHomeStreak';
import { ObjectiveSetupDialog } from '@/components/practice/ObjectiveSetupDialog';
import { useSessionStore } from '@/stores/useSessionStore';
import { useRecentPracticeSummary } from '@/hooks/useRecentPracticeSummary';
import type { PracticeSurface } from '@/services/pageContext';
import {
  trackPracticeEntryViewed, trackPracticeModeSelected,
  trackFreeformPracticeStarted,
} from '@/services/practiceTelemetry';
import { LandingHero } from '@/components/landing/LandingHero';
import { ProductsSection } from '@/components/landing/ProductsSection';
import { PrivateRepeatSection } from '@/components/landing/PrivateRepeatSection';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { BrowserWarning } from '@/components/BrowserWarning';
import { useBrowserSupport } from '@/hooks/useBrowserSupport';
import { LandingPricingSection } from '@/components/landing/LandingPricingSection';
import { ClosingCTASection } from '@/components/landing/ClosingCTASection';

export default function PracticePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuthProvider();
  const isAuthed = !!user;
  const { setSurface } = usePracticeSurface();
  // #1475 G12 Rev 2 §0.3: the signed-out homepage keeps the shell's browser-capability warning.
  const { isSupported: browserSupported, error: browserSupportError } = useBrowserSupport();
  // #1042 PR4: narrow recent-session read (authed only; the hook is disabled without a user).
  const { data: recentSessions, isLoading: recentLoading, error: recentError } = useRecentPracticeSummary();
  const lastSession = recentSessions && recentSessions.length > 0 ? recentSessions[0] : null;
  // #1093: the streak is now server-authoritative (get_practice_streak, #1098) — NOT the dead
  // check-usage-limit.streak_count and NOT a localStorage guess. Keyed by user id with stale-response
  // protection; the chip is always visible (loading → skeleton, else a settled label).
  const { streak: homeStreak, loading: homeStreakLoading } = useHomeStreak(user?.id ?? null);
  // Focus Points is ACTIVATED: opening the points-setup modal is the objective surface for Report Issue.
  const [objectiveSetupOpen, setObjectiveSetupOpen] = React.useState(false);
  const returning = React.useRef(false);
  // Header → Focus Points arrives as ?product=focus-points (#1543 Dev 5900357101). Every route sits in App's AnimatePresence,
  // so more than one PracticePage instance can be mounted around a navigation, and all read the live url. The intent used
  // to be CONSUMED on mount (open, then delete the param); an instance that consumed it and was then torn down left the
  // visible page with no dialog and no param — the user landed on Home. Now the url IS the intent: the dialog is open
  // while the param is present, on a page that is present (an exiting one never shows it), and the param is removed only
  // when the person closes the dialog. No instance can destroy the intent on mount.
  const isPresent = useIsPresent();
  const focusIntent = isAuthed && searchParams.get('product') === 'focus-points';
  const setupOpen = isPresent && (objectiveSetupOpen || focusIntent);
  const setSetupOpen = React.useCallback((open: boolean) => {
    setObjectiveSetupOpen(open);
    if (open || searchParams.get('product') !== 'focus-points') return;
    const next = new URLSearchParams(searchParams);
    next.delete('product');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  React.useEffect(() => {
    try {
      returning.current = localStorage.getItem('speaksharp_practice_seen') === '1';
      localStorage.setItem('speaksharp_practice_seen', '1');
    } catch { /* ignore storage errors */ }
    trackPracticeEntryViewed(returning.current);
  }, []);

  React.useEffect(() => {
    // Focus Points is available: the objective surface is the points-setup modal being open, not an
    // "unavailable" state. Report Issue on /practice reflects exactly which of the two surfaces is active.
    const surface: PracticeSurface = setupOpen ? 'objective_setup' : 'practice_home';
    setSurface(surface);
  }, [setupOpen, setSurface]);

  React.useEffect(() => () => { setSurface(null); }, [setSurface]);

  // Freeform: authed → /session directly; anonymous → account access preserving the /session intent via
  // location.state.from (resolvePostAuthPath honors safe deep-links). Never auto-starts recording.
  const startFreeform = () => {
    trackPracticeModeSelected('quick', 'landing_card');
    trackFreeformPracticeStarted('landing_card');
    if (isAuthed) navigate('/session');
    else navigate('/auth/signup', { state: { from: { pathname: '/session' } } });
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
    // #1258 PM RETURN 5901196048: saving COMPLETES the url-held intent. One navigation that REPLACES the
    // ?product=focus-points entry, so Back from the session never reopens a blank setup for a brief already saved. The
    // card path (no url intent) keeps its normal history entry.
    navigate('/session', { replace: searchParams.get('product') === 'focus-points' });
  };

  if (isAuthed) {
    /* #1047 AUTHENTICATED product state — an entirely separate surface. The user has already converted,
       so there is no hero, no tagline and no marketing copy: a question, and two answers. */
    return (
      // App.tsx owns the single <main id="main-content"> landmark; this is a plain content container.
      <div className="practice-root ss-landing-canvas min-h-screen font-sans antialiased" data-testid="practice-root">
        <div className="practice-content">
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
        </div>
        <ObjectiveSetupDialog
          open={setupOpen}
          onOpenChange={setSetupOpen}
          onReady={handleObjectiveReady}
        />
      </div>
    );
  }

  return (
    // App.tsx owns the single <main id="main-content"> landmark and the global Navigation; this is a plain
    // content container for the #1475 G12 Rev 2 homepage, closed by the shell footer (ruling A1 on #1475).
    <div className="practice-root min-h-screen bg-neutral-page font-sans antialiased" data-testid="practice-root">
      {!browserSupported && browserSupportError && (
        <div className="px-5 pb-2 pt-[calc(var(--header-height)+1rem)] md:px-7 lg:px-[34px]">
          <BrowserWarning isSupported={browserSupported} supportError={browserSupportError} />
        </div>
      )}
      <LandingHero />
      <ProductsSection onStartFreeform={startFreeform} onStartObjective={startObjective} />
      <PrivateRepeatSection />
      <LandingPricingSection />
      <ClosingCTASection />
      <LandingFooter />
    </div>
  );
}
