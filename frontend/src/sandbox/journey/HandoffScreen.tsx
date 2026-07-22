/**
 * Phase 2 SANDBOX — SpeakSharp Session handoff (representation only).
 *
 * "Start a session" is a doorway to the EXISTING SpeakSharp session experience (the canonical
 * production route `/session`). The standalone sandbox is isolated, so it does NOT navigate there
 * (that would boot the production app / add traffic) — it REPRESENTS the handoff: what the user would
 * see, and where it goes. The existing session experience is unchanged and is not rebuilt here.
 */

import React from 'react';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { PrimaryButton, SecondaryButton, Panel } from '../components/ui';
import { QuickPracticeVignette } from '../components/vignettes';
import { trace } from '../trace';

/** The canonical existing session route (verified in frontend/src/App.tsx). */
export const SESSION_ROUTE = '/session';

export function HandoffScreen({ onBack }: { onBack: () => void }) {
  React.useEffect(() => { trace('session_handoff', {}); }, []);
  return (
    <div className="min-h-[calc(100vh-3.5rem)] px-5 py-16 sm:px-8">
      <div className="mx-auto max-w-xl">
        <Panel className="text-center">
          <div className="mx-auto mb-4 w-16"><QuickPracticeVignette /></div>
          <h2 className="text-2xl font-semibold text-[color:var(--ss-text)]">Opening your SpeakSharp session</h2>
          <p className="mt-3 text-[15px] text-[color:var(--ss-text-secondary)]">
            Quick Practice continues in the SpeakSharp session experience you already know — your standard speaking session, unchanged.
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[color:var(--ss-primary-soft)] px-4 py-2.5 text-sm font-semibold text-[color:var(--ss-primary-soft-text)]">
            Continue <ArrowRight size={16} aria-hidden /> your SpeakSharp session
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <PrimaryButton onClick={() => { /* represented only — the sandbox never opens production */ }}>
              <ExternalLink size={16} aria-hidden /> Continue to session
            </PrimaryButton>
            <SecondaryButton onClick={onBack}>Back to practice choices</SecondaryButton>
          </div>
          <p className="mt-6 text-xs text-[color:var(--ss-neutral)]">
            Sandbox note: in the product this opens the existing route <code className="rounded bg-[color:var(--ss-canvas)] px-1">{SESSION_ROUTE}</code>. This isolated sandbox represents the handoff and does not open the production app.
          </p>
        </Panel>
      </div>
    </div>
  );
}
