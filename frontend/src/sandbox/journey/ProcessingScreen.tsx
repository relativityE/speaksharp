/**
 * Phase 2 SANDBOX — Processing ("Finalizing…") state, shown briefly between finishing a rehearsal and
 * the outcome summary. Stands in for finalization; it exposes no numbers, just calm progress.
 */

import React from 'react';
import { RecordingIndicator } from '../components/ui';

export function ProcessingScreen({ onDone }: { onDone: () => void }) {
  React.useEffect(() => {
    const t = window.setTimeout(onDone, 1600);
    return () => window.clearTimeout(t);
  }, [onDone]);

  return (
    <div className="grid min-h-[calc(100vh-3.5rem)] place-items-center px-5">
      <div className="ss-fade-up flex flex-col items-center gap-5 text-center">
        <RecordingIndicator status="processing" />
        <div>
          <h2 className="text-2xl font-semibold text-[color:var(--ss-text)]">Finalizing your rehearsal…</h2>
          <p className="mt-1 text-sm text-[color:var(--ss-text-secondary)]">Reviewing what you covered — this only takes a moment.</p>
        </div>
        <div className="h-1.5 w-48 overflow-hidden rounded-full bg-[color:var(--ss-border)]" role="progressbar" aria-label="Finalizing">
          <div className="ss-breathe h-full w-1/2 rounded-full motion-reduce:w-full" style={{ background: 'linear-gradient(90deg, var(--ss-primary), var(--ss-listening))' }} />
        </div>
      </div>
    </div>
  );
}
