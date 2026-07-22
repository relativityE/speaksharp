/**
 * Phase 2 SANDBOX — Prepare screen. Calm setup with a ready-made sample so review needs no typing.
 * The agenda is optional (general practice skips it). One obvious primary action: Start rehearsal.
 */

import React from 'react';
import { Mic, ListChecks } from 'lucide-react';
import { T } from '../theme';
import { Panel, PrimaryButton, SecondaryButton } from '../components/ui';
import { SAMPLE_BRIEF } from '../sample';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <input
        defaultValue={value}
        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[15px] text-slate-800 shadow-sm outline-none focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-200"
      />
    </label>
  );
}

export function PrepareScreen({ onStart, onStartGeneral }: { onStart: () => void; onStartGeneral: () => void }) {
  return (
    <div className={`min-h-[calc(100vh-4rem)] ${T.frame} px-5 py-10 sm:px-8`}>
      <div className="mx-auto max-w-2xl">
        <p className="mb-1 text-sm font-medium text-indigo-300">Executive rehearsal</p>
        <h2 className="mb-6 text-2xl font-semibold text-white">What are you rehearsing?</h2>

        <Panel>
          <div className="space-y-4">
            <Field label="What are you rehearsing?" value={SAMPLE_BRIEF.objective} />
            <Field label="Who is the audience?" value={SAMPLE_BRIEF.audience} />
            <Field label="What outcome do you want?" value={SAMPLE_BRIEF.desiredDecision} />
          </div>

          <div className="mt-6">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <ListChecks size={16} className="text-indigo-500" aria-hidden /> Agenda — the points you intend to cover
              <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">optional</span>
            </div>
            <ol className="space-y-2">
              {SAMPLE_BRIEF.talkingPoints.map((p, i) => (
                <li key={i} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-600">{i + 1}</span>
                  <span className="text-[15px] text-slate-800">{p}</span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-slate-500">3–5 points work best. Leave the agenda out for open-ended general practice.</p>
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <PrimaryButton onClick={onStart}>
              <Mic size={18} aria-hidden /> Start rehearsal
            </PrimaryButton>
            <SecondaryButton onClick={onStartGeneral}>Skip agenda — general practice</SecondaryButton>
          </div>
        </Panel>
      </div>
    </div>
  );
}
