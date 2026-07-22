/**
 * Phase 2 SANDBOX page — Personal Progress + Executive Rehearsal UX proving ground.
 *
 * LOCALHOST ONLY. Standalone Vite entry (frontend/sandbox.html → sandbox-main.tsx). Imports NO app
 * provider, store, service, Supabase, PostHog, Sentry, Stripe, or AI client. All data is static
 * in-memory fixtures; all computation is local; there is NO network I/O.
 */

import React from 'react';
import { FlaskConical, ListChecks, User } from 'lucide-react';
import { FIXTURES, type Fixture, type FixtureId } from './fixtures';
import { GeneralProgressView } from './components/GeneralProgressView';
import { AgendaRailView } from './components/AgendaRailView';
import { trace } from './trace';

type ModeFilter = 'all' | 'general' | 'rehearsal';

const USABILITY_QUESTIONS = [
  'Do you understand that the first session sets a personal baseline (not a grade)?',
  'Is it clear that 100% means "this target reached", not "perfect speaking"?',
  'Is every percentage explainable from baseline, previous, current, target, and the calculation?',
  'Are the live agenda states subtle (passive, never interrupting)?',
  'Is one next focus more useful than many simultaneous metrics?',
  'Do delivery progress and agenda coverage read as clearly separate?',
];

export function ProgressRehearsalSandbox() {
  const [modeFilter, setModeFilter] = React.useState<ModeFilter>('all');
  const [selectedId, setSelectedId] = React.useState<FixtureId>(FIXTURES[0].id);

  React.useEffect(() => {
    trace('sandbox_loaded', { visibleItemCount: FIXTURES.length });
  }, []);

  const visible = FIXTURES.filter((f) => (modeFilter === 'all' ? true : f.mode === modeFilter));
  const selected: Fixture = FIXTURES.find((f) => f.id === selectedId) ?? FIXTURES[0];

  // Keep the selection valid when the mode filter hides it.
  React.useEffect(() => {
    if (!visible.some((f) => f.id === selectedId) && visible.length > 0) setSelectedId(visible[0].id);
  }, [modeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectMode = (m: ModeFilter) => { setModeFilter(m); trace('practice_mode_selected', { mode: m === 'rehearsal' ? 'rehearsal' : 'general' }); };
  const selectFixture = (f: Fixture) => { setSelectedId(f.id); trace('fixture_selected', { fixtureId: f.id, mode: f.mode }); };

  return (
    <div className="min-h-screen bg-background font-sans text-foreground antialiased">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-5 py-4">
          <FlaskConical className="text-primary" aria-hidden />
          <div className="mr-auto">
            <h1 className="text-lg font-semibold leading-tight">Personal Progress &amp; Executive Rehearsal — UX sandbox</h1>
            <p className="text-sm text-muted-foreground">Localhost-only · static fixtures · no network, no production data</p>
          </div>
          <span className="rounded-full border border-amber-400 bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            Sandbox
          </span>
        </div>
      </header>

      <main id="main-content" className="mx-auto max-w-5xl px-5 py-6">
        {/* Mode filter */}
        <div role="tablist" aria-label="Practice mode" className="mb-4 inline-flex rounded-lg border border-border bg-card p-1">
          {(['all', 'general', 'rehearsal'] as ModeFilter[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={modeFilter === m}
              onClick={() => selectMode(m)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${modeFilter === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {m === 'all' ? 'All states' : m === 'general' ? 'General practice' : 'Executive rehearsal'}
            </button>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          {/* Fixture switcher */}
          <nav aria-label="Fixture states" className="space-y-1">
            {visible.map((f) => (
              <button
                key={f.id}
                onClick={() => selectFixture(f)}
                aria-current={f.id === selectedId}
                className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${f.id === selectedId ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/40'}`}
              >
                {f.mode === 'general' ? <User size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden /> : <ListChecks size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />}
                <span>
                  <span className="font-medium">{f.label}</span>
                </span>
              </button>
            ))}
          </nav>

          {/* Selected fixture */}
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{selected.blurb}</p>
            {selected.mode === 'general' ? <GeneralProgressView fixture={selected} /> : <AgendaRailView fixture={selected} />}

            <details className="rounded-xl border border-border bg-card">
              <summary className="cursor-pointer list-none px-5 py-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Reviewer checklist — what to evaluate
              </summary>
              <ul className="list-disc space-y-1 px-9 py-3 text-sm text-muted-foreground">
                {USABILITY_QUESTIONS.map((q) => <li key={q}>{q}</li>)}
              </ul>
            </details>
          </div>
        </div>
      </main>
    </div>
  );
}
