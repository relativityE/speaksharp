/**
 * Phase 2 SANDBOX — Processing ("Finalizing…") state, shown briefly between finishing a rehearsal and
 * the outcome summary. Stands in for on-device finalization; it exposes no numbers, just calm progress.
 */

import React from 'react';
import { RecordingIndicator } from '../components/ui';

export function ProcessingScreen({ onDone }: { onDone: () => void }) {
  React.useEffect(() => {
    const t = window.setTimeout(onDone, 1600);
    return () => window.clearTimeout(t);
  }, [onDone]);

  return (
    <div className="grid min-h-[calc(100vh-3.5rem)] place-items-center bg-slate-900 px-5">
      <div className="ss-fade-up flex flex-col items-center gap-5 text-center">
        <RecordingIndicator status="processing" />
        <div>
          <h2 className="text-xl font-semibold text-white">Finalizing your rehearsal…</h2>
          <p className="mt-1 text-sm text-slate-400">Reviewing what you covered — this stays on your device.</p>
        </div>
        <div className="h-1.5 w-48 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-label="Finalizing">
          <div className="h-full w-1/3 animate-[ss-fade-up_1.2s_ease-in-out_infinite] rounded-full bg-indigo-500 motion-reduce:w-full" />
        </div>
      </div>
    </div>
  );
}
