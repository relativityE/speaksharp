/**
 * Phase 2 SANDBOX — QA "Review all states" panel (secondary, collapsed by default).
 *
 * The fixture switcher for inspecting every result state lives here, clearly separated from the
 * product journey so a first-time reviewer is never confronted with "what is a fixture". Selection is
 * derived during render (no effect), so there is no hook-dependency suppression.
 */

import React from 'react';
import { FIXTURES, type Fixture, type FixtureId } from '../fixtures';
import { GeneralProgressView } from './GeneralProgressView';
import { AgendaRailView } from './AgendaRailView';
import { trace } from '../trace';

export function ReviewPanel() {
  const [selectedId, setSelectedId] = React.useState<FixtureId>(FIXTURES[0].id);
  // Derive the effective selection during render — no effect, no hook-dependency suppression needed.
  const selected: Fixture = FIXTURES.find((f) => f.id === selectedId) ?? FIXTURES[0];

  return (
    <details
      className="mx-auto mt-6 max-w-5xl rounded-2xl border border-slate-700 bg-slate-800/40"
      onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) trace('review_states_opened', {}); }}
    >
      <summary className="cursor-pointer list-none px-5 py-3 text-sm font-semibold text-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
        Review all states (QA) — inspect every result fixture
      </summary>
      <div className="border-t border-slate-700 p-4">
        <p className="mb-3 text-xs text-slate-400">Internal QA only — these are the individual calculation states behind the product experience above.</p>
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Fixture states" className="space-y-1">
            {FIXTURES.map((f) => (
              <button
                key={f.id}
                onClick={() => { setSelectedId(f.id); trace('fixture_selected', { fixtureId: f.id, mode: f.mode }); }}
                aria-current={f.id === selectedId}
                className={`block w-full rounded-lg border px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${f.id === selectedId ? 'border-indigo-400 bg-indigo-500/10 text-white' : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-500'}`}
              >
                {f.label}
              </button>
            ))}
          </nav>
          <div className="rounded-xl bg-[#faf8f4] p-3">
            {selected.mode === 'general' ? <GeneralProgressView fixture={selected} /> : <AgendaRailView fixture={selected} />}
          </div>
        </div>
      </div>
    </details>
  );
}
