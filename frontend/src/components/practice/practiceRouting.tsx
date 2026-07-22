/**
 * Practice-entry routing glue — the ASYNC, identity-correct gate for the rollout flag.
 *
 * Two consumers share one bounded decision (`resolveAuthedFlag`, see services/practiceEntryFlags):
 *  - `PostAuthRedirect`  — where an authenticated user lands after sign-in (or when an already-signed-in
 *                          user hits /auth). A safe deep-link wins immediately; else targeted → /practice,
 *                          everyone else → the unchanged /session.
 *  - `PracticeEntryGate` — wraps the /practice route so DIRECT navigation obeys the SAME rollout gate:
 *                          flag OFF → redirect to /session (the claimed one-switch rollback is now real).
 *
 * Both fail to /session and use a bounded timeout, so auth/navigation never blocks indefinitely.
 */

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { ENV } from '@/config/TestFlags';
import { resolveAuthedFlag, resolveAuthedDefaultPath } from '@/services/practiceEntryFlags';

type FromLocation = { pathname?: string; search?: string } | null | undefined;

/** E2E/preview override: force the gate ON via `window.__SS_E2E__.flags.practiceEntry` (test-only). */
function e2eForcedEnabled(): boolean | null {
  if (!ENV.isE2E) return null;
  try {
    const w = window as unknown as { __SS_E2E__?: { flags?: { practiceEntry?: boolean } } };
    const v = w.__SS_E2E__?.flags?.practiceEntry;
    return typeof v === 'boolean' ? v : null;
  } catch { return null; }
}

type Decision = 'pending' | 'enabled' | 'disabled';

/** Bounded, authed-identity-correct rollout decision for the current user. */
function usePracticeEntryDecision(): Decision {
  const { user } = useAuthProvider();
  const userId = user?.id ?? null;
  const [decision, setDecision] = React.useState<Decision>('pending');

  React.useEffect(() => {
    let active = true;
    const forced = e2eForcedEnabled();
    if (forced !== null) { setDecision(forced ? 'enabled' : 'disabled'); return; }
    if (!userId) { setDecision('disabled'); return; }
    setDecision('pending');
    void resolveAuthedFlag(userId).then((enabled) => {
      if (active) setDecision(enabled ? 'enabled' : 'disabled');
    });
    return () => { active = false; };
  }, [userId]);

  return decision;
}

function GateLoader() {
  return (
    <div className="flex h-[50vh] w-full items-center justify-center" data-testid="practice-gate-loading">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

/** Route guard for /practice: renders children only when the rollout flag is ON for this user. */
export const PracticeEntryGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const decision = usePracticeEntryDecision();
  if (decision === 'pending') return <GateLoader />;
  if (decision === 'disabled') return <Navigate to="/session" replace />;
  return <>{children}</>;
};

/**
 * Post-auth landing. Resolves the destination once the authenticated user id is known, then redirects.
 * A safe deep-link wins immediately; otherwise targeted → /practice, everyone else → /session.
 */
export const PostAuthRedirect: React.FC<{ from?: FromLocation }> = ({ from }) => {
  const { user } = useAuthProvider();
  const userId = user?.id ?? null;
  // Explicit scalar deps (no exhaustive-deps suppression): recompute only when the identity or the
  // meaningful return-path values change. The `from` object is reconstructed inside the effect.
  const fromPathname = from?.pathname;
  const fromSearch = from?.search;
  const [path, setPath] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    const forced = e2eForcedEnabled();
    if (forced !== null) { setPath(forced ? '/practice' : '/session'); return; }
    const fromArg = fromPathname ? { pathname: fromPathname, search: fromSearch } : null;
    void resolveAuthedDefaultPath(userId, fromArg).then((p) => { if (active) setPath(p); });
    return () => { active = false; }; // cancellation: a stale async decision cannot navigate after unmount
  }, [userId, fromPathname, fromSearch]);

  if (!path) return <GateLoader />;
  return <Navigate to={path} replace />;
};

/**
 * Dedicated authenticated CONTINUATION route (e.g. the magic-link email return target). It is PUBLIC, so
 * it renders while the session is being recovered from the URL — waiting on `loading` — instead of a
 * ProtectedRoute bouncing the just-recovered magic-link user to /auth before the session settles. Once the
 * authenticated session exists, it defers to PostAuthRedirect, which runs the SAME post-identify flag
 * decision as password sign-in (targeted → /practice; non-targeted/error/timeout → /session; deep-link
 * wins). No anonymous flag is ever read. No loop: with no recovered session it falls back to sign-in.
 */
export const PostAuthContinue: React.FC = () => {
  const { user, loading } = useAuthProvider();
  const location = useLocation();
  const from = (location.state as { from?: FromLocation } | null)?.from ?? null;
  if (loading) return <GateLoader />;                       // wait for the (magic-link) session to resolve
  if (!user) return <Navigate to="/auth/signin" replace />; // no session recovered → sign in (not a loop)
  return <PostAuthRedirect from={from} />;
};
