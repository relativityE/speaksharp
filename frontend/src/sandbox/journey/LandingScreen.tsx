/**
 * Phase 2 SANDBOX — practice starting page (two-column chooser, "Confident Momentum").
 *
 * Truthful identity: "SpeakSharp Practice — How would you like to practice?" TWO equal choices,
 * Quick Practice (left) and Executive Rehearsal (right), side-by-side on desktop and stacked on
 * mobile. Each is a white card with a vignette, title, one-line benefit, and a numbered
 * progressive-disclosure list; only ONE numbered row across BOTH columns is open at a time, and
 * completed rows collapse to a checkmark rollup. Review My Progress is a subordinate link, not a
 * third choice. Predominantly warm/ivory; navy is bounded to the app bar. No sidebar.
 */

import React from 'react';
import { ChevronDown, Check, Play, PencilLine, ArrowRight } from 'lucide-react';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import { QuickPracticeVignette, ExecutiveRehearsalVignette } from '../components/vignettes';

export interface LandingActions {
  startRehearsal: () => void;
  createRehearsal: () => void;
  startQuick: () => void;
  reviewProgress: () => void;
}

type Col = 'quick' | 'exec';
interface RowDef { title: string; rollup: string; subtasks: string[] }
interface ColumnDef {
  key: Col;
  title: string;
  benefit: string;
  Vignette: React.FC;
  rows: RowDef[];
  actions: React.ReactNode;
}

interface OpenRow { col: Col; row: number }

function NumberedRows({ col, rows, open, setOpen }: { col: Col; rows: RowDef[]; open: OpenRow | null; setOpen: (o: OpenRow | null) => void }) {
  const activeRow = open && open.col === col ? open.row : -1;
  return (
    <ol className="space-y-2">
      {rows.map((r, i) => {
        const isOpen = activeRow === i;
        const done = i < activeRow;
        const badge = done ? 'bg-[color:var(--ss-success-soft)] text-[color:var(--ss-success-text)]' : isOpen ? 'bg-[color:var(--ss-primary)] text-white' : 'bg-[color:var(--ss-neutral-soft)] text-[color:var(--ss-neutral-text)]';
        return (
          <li key={i} className="overflow-hidden rounded-xl bg-[color:var(--ss-canvas)] ring-1 ring-[color:var(--ss-border)]">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={`row-${col}-${i}`}
              aria-label={r.title}
              onClick={() => setOpen(isOpen ? null : { col, row: i })}
              className="ss-ring flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
            >
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${badge}`}>{done ? <Check size={13} aria-hidden /> : i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[color:var(--ss-text)]">{r.title}</span>
                {!isOpen ? <span className="block text-[11px] text-[color:var(--ss-neutral)]">{done ? r.rollup : ''}</span> : null}
              </span>
              <ChevronDown size={15} aria-hidden style={{ color: 'var(--ss-neutral)' }} className={`shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen ? (
              <ul id={`row-${col}-${i}`} className="ss-fade-up space-y-1.5 border-t border-[color:var(--ss-border)] bg-white px-4 py-3 text-sm text-[color:var(--ss-text-secondary)]">
                {r.subtasks.map((t) => <li key={t} className="flex items-start gap-2"><span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--ss-primary)' }} />{t}</li>)}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Card({ c, open, setOpen, emphasize }: { c: ColumnDef; open: OpenRow | null; setOpen: (o: OpenRow | null) => void; emphasize?: boolean }) {
  const active = open?.col === c.key;
  return (
    <section className={`flex flex-col rounded-2xl bg-white p-5 shadow-lg shadow-slate-900/[0.06] transition ${active || emphasize ? 'ring-2 ring-[color:var(--ss-primary)]' : 'ring-1 ring-[color:var(--ss-border)]'}`}>
      <div className="flex items-start gap-4">
        <c.Vignette />
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-[color:var(--ss-text)]">{c.title}{emphasize ? <span className="ml-2 rounded-full bg-[color:var(--ss-primary-soft)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--ss-primary-soft-text)]">Last used</span> : null}</h3>
          <p className="mt-0.5 text-sm text-[color:var(--ss-text-secondary)]">{c.benefit}</p>
        </div>
      </div>
      <div className="mt-4 flex-1">
        <NumberedRows col={c.key} rows={c.rows} open={open} setOpen={setOpen} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">{c.actions}</div>
    </section>
  );
}

export function LandingScreen({ actions, returning = false, lastMode }: { actions: LandingActions; returning?: boolean; lastMode?: Col }) {
  const [open, setOpen] = React.useState<OpenRow | null>(returning && lastMode ? { col: lastMode, row: 0 } : null);

  const columns: ColumnDef[] = [
    {
      key: 'quick', title: 'Quick Practice', benefit: 'Speak freely without preparing an agenda.', Vignette: QuickPracticeVignette,
      rows: [
        { title: 'Start speaking', rollup: 'Ready to record', subtasks: ['Just begin — no agenda to set up.'] },
        { title: 'Finish the session', rollup: 'Session captured', subtasks: ['Stop when you’re done; SpeakSharp finalizes on your device.'] },
        { title: 'Review one improvement', rollup: 'One focus to try next', subtasks: ['See a single, plain-language thing to work on next time.'] },
      ],
      actions: <PrimaryButton className="px-4 py-2.5 text-sm" onClick={actions.startQuick}><Play size={15} aria-hidden /> Start quick practice</PrimaryButton>,
    },
    {
      key: 'exec', title: 'Executive Rehearsal', benefit: 'Practice against the outcomes you intend to cover.', Vignette: ExecutiveRehearsalVignette,
      rows: [
        { title: 'Prepare', rollup: '3 agenda points prepared', subtasks: ['Define the presentation or conversation.', 'Identify the audience and intended outcome.', 'Add 3–5 agenda points or use the prepared sample.'] },
        { title: 'Rehearse naturally', rollup: 'Agenda tracked passively', subtasks: ['Speak while your agenda is tracked passively.', 'Request help only if you want it — Pause or Finish anytime.'] },
        { title: 'Review and recover', rollup: 'Covered · recovered · next focus', subtasks: ['See what you covered, partly covered, missed, and recovered.', 'Inspect one suggested remedy, then rehearse again.'] },
      ],
      actions: (
        <>
          <PrimaryButton className="px-4 py-2.5 text-sm" onClick={actions.startRehearsal}><Play size={15} aria-hidden /> Try a sample</PrimaryButton>
          <SecondaryButton onClick={actions.createRehearsal}><PencilLine size={14} aria-hidden /> Create rehearsal</SecondaryButton>
        </>
      ),
    },
  ];

  return (
    <div className="min-h-[calc(100vh-3.5rem)] px-5 py-10 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-medium text-[color:var(--ss-primary)]">SpeakSharp Practice</p>
        <h2 className="mt-1 text-2xl font-semibold text-[color:var(--ss-text)] sm:text-3xl">How would you like to practice?</h2>
        <p className="mt-3 max-w-2xl text-[15px] text-[color:var(--ss-text-secondary)]">
          {returning
            ? 'Welcome back — pick up where you left off, or try the other way to practice.'
            : 'Choose a quick speaking session or rehearse against the outcomes you need to cover. SpeakSharp guides the session quietly and keeps the analysis in the background.'}
        </p>

        {/* Exactly two equal practice choices — side by side (desktop), stacked (mobile) */}
        <div className="mt-8 grid grid-cols-1 items-stretch gap-4 md:grid-cols-2">
          {columns.map((c) => <Card key={c.key} c={c} open={open} setOpen={setOpen} emphasize={returning && lastMode === c.key} />)}
        </div>

        {/* Review My Progress — subordinate, not a practice choice */}
        <div className="mt-6 text-center">
          <button onClick={actions.reviewProgress} className="ss-ring inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-[color:var(--ss-text-secondary)] hover:text-[color:var(--ss-primary)]">
            View past progress <ArrowRight size={15} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
