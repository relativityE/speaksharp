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
import { PracticeLoopSection } from '@/components/landing/PracticeLoopSection';
import { LandingPricingSection } from '@/components/landing/LandingPricingSection';
import { ClosingCTASection } from '@/components/landing/ClosingCTASection';

export default function PracticePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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
  // Focus Points is ACTIVATED: opening the points-setup modal is the objective surface for Report Issue.
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
    if (!isAuthed || searchParams.get('product') !== 'focus-points') return;
    setObjectiveSetupOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('product');
    setSearchParams(next, { replace: true });
  }, [isAuthed, searchParams, setSearchParams]);

  React.useEffect(() => {
    // Focus Points is available: the objective surface is the points-setup modal being open, not an
    // "unavailable" state. Report Issue on /practice reflects exactly which of the two surfaces is active.
    const surface: PracticeSurface = objectiveSetupOpen ? 'objective_setup' : 'practice_home';
    setSurface(surface);
  }, [objectiveSetupOpen, setSurface]);

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
    navigate('/session');
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
          open={objectiveSetupOpen}
          onOpenChange={setObjectiveSetupOpen}
          onReady={handleObjectiveReady}
        />
      </div>
    );
  }

  return (
    // App.tsx owns the single <main id="main-content"> landmark and the global Navigation; this is a plain
    // content container for the #1475 G12 homepage.
    <div className="practice-root min-h-screen bg-background font-sans antialiased" data-testid="practice-root">
      <LandingHero />
      <ProductsSection onStartFreeform={startFreeform} onStartObjective={startObjective} />
      <PracticeLoopSection />
      <LandingPricingSection />
      <ClosingCTASection />
    </div>
  );
}
