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
import { Navigate } from 'react-router-dom';
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
  const [path, setPath] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    const forced = e2eForcedEnabled();
    if (forced !== null) { setPath(forced ? '/practice' : '/session'); return; }
    void resolveAuthedDefaultPath(userId, from).then((p) => { if (active) setPath(p); });
    return () => { active = false; };
    // `from` is read once at mount; user id is the identity signal we wait on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!path) return <GateLoader />;
  return <Navigate to={path} replace />;
};
