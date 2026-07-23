/**
 * Practice-entry routing glue — flag-free. `/practice` is the authenticated default landing.
 *
 *  - `PostAuthRedirect`  — where an authenticated user lands after sign-in (or when an already-signed-in
 *                          user hits /auth). A safe deep-link wins; otherwise → /practice. Synchronous:
 *                          no PostHog, no flag, no timeout.
 *  - `PostAuthContinue`  — the PUBLIC magic-link return target (/auth/continue). It waits for the session
 *                          being recovered from the URL, then defers to PostAuthRedirect. No session →
 *                          sign-in (no loop).
 *
 * There is no rollout gate: /practice is a plain ProtectedRoute now, so a missing/timed-out/erroring
 * PostHog flag cannot affect whether a user reaches the approved landing.
 */

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { resolvePostAuthPath } from '@/services/postAuthRouting';

type FromLocation = { pathname?: string; search?: string } | null | undefined;

function GateLoader() {
  return (
    <div className="flex h-[50vh] w-full items-center justify-center" data-testid="practice-gate-loading">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

/**
 * Post-auth landing. A safe deep-link wins; otherwise the authenticated default is /practice.
 */
export const PostAuthRedirect: React.FC<{ from?: FromLocation }> = ({ from }) => {
  return <Navigate to={resolvePostAuthPath(from)} replace />;
};

/**
 * Dedicated authenticated CONTINUATION route (the magic-link email return target). It is PUBLIC, so it
 * renders while the session is being recovered from the URL — waiting on `loading` — instead of a
 * ProtectedRoute bouncing the just-recovered magic-link user to /auth before the session settles. Once the
 * authenticated session exists, it defers to PostAuthRedirect (deep-link → that, else → /practice). No
 * loop: with no recovered session it falls back to sign-in.
 */
export const PostAuthContinue: React.FC = () => {
  const { user, loading } = useAuthProvider();
  const location = useLocation();
  const from = (location.state as { from?: FromLocation } | null)?.from ?? null;
  if (loading) return <GateLoader />;                       // wait for the (magic-link) session to resolve
  if (!user) return <Navigate to="/auth/signin" replace />; // no session recovered → sign in (not a loop)
  return <PostAuthRedirect from={from} />;
};
