/**
 * Phase 2 SANDBOX — practice starting page (two-column chooser; theme-comparison gate).
 *
 * Truthful identity: "SpeakSharp Practice — Choose how you want to practice." TWO equal choices —
 * SpeakSharp Session (left, a doorway to the existing /session experience) and Executive Rehearsal
 * (right) — side-by-side on desktop, stacked on mobile. Review My Progress is a subordinate link.
 *
 * This screen is themeable for the theme-comparison gate: `theme` ('a' | 'b' | 'c') is applied via
 * data-ss-theme on the landing root, overriding the semantic tokens for THIS subtree only (see
 * sandbox.css). Composition is deliberately expressive: an integrated LIGHT hero band (brand header +
 * preamble) sits above two cards that each lead with a substantial illustrated visual panel in their
 * OWN accent (Session vs Executive Rehearsal), with a non-form numbered list and an accent action.
 * Selecting a card changes its tint, elevation, border, and illustration emphasis — not just an
 * outline. The FROZEN information architecture (two columns, progressive disclosure, mutual exclusion,
 * subordinate progress link, no sidebar) is identical across all three themes.
 */

import React from 'react';
import { ChevronDown, Check, Play, PencilLine, ArrowRight, FlaskConical } from 'lucide-react';
import { SessionPanelArt, ExecPanelArt } from '../components/vignettes';

export type LandingTheme = 'a' | 'b' | 'c';

export interface LandingActions {
  startRehearsal: () => void;
  createRehearsal: () => void;
  startSession: () => void; // doorway to the existing SpeakSharp session (/session)
  reviewProgress: () => void;
}

type Col = 'session' | 'exec';
interface RowDef { title: string; rollup: string; subtasks: string[] }
interface ColumnDef {
  key: Col;
  title: string;
  benefit: string;
  Art: React.FC<{ emphasis?: boolean }>;
  rows: RowDef[];
  actions: React.ReactNode;
}
interface OpenRow { col: Col; row: number }

// Per-card accent variables (map the theme's Session/Executive accents onto generic --ss-card-* names
// the card subtree reads). This is what makes the two choices visually distinct within each theme.
const CARD_VARS: Record<Col, React.CSSProperties> = {
  session: {
    ['--ss-card' as string]: 'var(--ss-session-accent)',
    ['--ss-card-btn' as string]: 'var(--ss-session-btn)',
    ['--ss-card-soft' as string]: 'var(--ss-session-soft)',
    ['--ss-card-panel' as string]: 'var(--ss-session-panel)',
    ['--ss-card-warm' as string]: 'var(--ss-sun)',
  },
  exec: {
    ['--ss-card' as string]: 'var(--ss-exec-accent)',
    ['--ss-card-btn' as string]: 'var(--ss-exec-btn)',
    ['--ss-card-soft' as string]: 'var(--ss-exec-soft)',
    ['--ss-card-panel' as string]: 'var(--ss-exec-panel)',
    ['--ss-card-warm' as string]: 'var(--ss-coral)',
  },
};

function NumberedRows({ col, rows, open, setOpen }: { col: Col; rows: RowDef[]; open: OpenRow | null; setOpen: (o: OpenRow | null) => void }) {
  const activeRow = open && open.col === col ? open.row : -1;
  return (
    <ol className="space-y-1.5">
      {rows.map((r, i) => {
        const isOpen = activeRow === i;
        const done = i < activeRow;
        const badge = done
          ? 'bg-[color:var(--ss-success-soft)] text-[color:var(--ss-success-text)]'
          : isOpen
            ? 'text-white'
            : 'bg-[color:var(--ss-card-soft)] text-[color:var(--ss-card-btn)]';
        return (
          // Non-form rows: no ring by default; a soft tinted row that fills with the card accent when open.
          <li key={i} className={`overflow-hidden rounded-xl transition-colors ${isOpen ? 'bg-[color:var(--ss-card-soft)]' : 'hover:bg-[color:var(--ss-card-soft)]'}`}>
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={`row-${col}-${i}`}
              aria-label={r.title}
              onClick={() => setOpen(isOpen ? null : { col, row: i })}
              className="ss-ring flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left"
            >
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${badge}`} style={isOpen && !done ? { background: 'var(--ss-card-btn)' } : undefined}>
                {done ? <Check size={13} aria-hidden /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[color:var(--ss-text)]">{r.title}</span>
                {!isOpen && done ? <span className="block text-[11px] text-[color:var(--ss-neutral)]">{r.rollup}</span> : null}
              </span>
              <ChevronDown size={15} aria-hidden style={{ color: 'var(--ss-card-btn)' }} className={`shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen ? (
              <ul id={`row-${col}-${i}`} className="ss-fade-up space-y-1.5 px-4 pb-3 pt-0.5 text-sm text-[color:var(--ss-text-secondary)]">
                {r.subtasks.map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--ss-card)' }} />
                    {t}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Card({ c, open, setOpen, emphasize }: { c: ColumnDef; open: OpenRow | null; setOpen: (o: OpenRow | null) => void; emphasize?: boolean }) {
  const selected = open?.col === c.key || !!emphasize;
  return (
    <section
      style={CARD_VARS[c.key]}
      className={`group flex flex-col overflow-hidden rounded-3xl bg-[color:var(--ss-surface)] transition-all duration-200 ${
        selected
          ? 'shadow-xl shadow-slate-900/[0.13] ring-2 ring-[color:var(--ss-card)] -translate-y-1'
          : 'shadow-lg shadow-slate-900/[0.06] ring-1 ring-[color:var(--ss-border)] hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-900/[0.08]'
      }`}
    >
      {/* Substantial illustrated visual region — emphasis increases when the card is selected */}
      <div className={`ss-card-panel relative h-28 border-b border-[color:var(--ss-border)] transition-opacity ${selected ? 'opacity-100' : 'opacity-90'}`}>
        <div className="absolute inset-0 px-5 py-3"><c.Art emphasis={selected} /></div>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-[color:var(--ss-text)]">{c.title}</h3>
          {emphasize ? <span className="rounded-full bg-[color:var(--ss-card-soft)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--ss-card-btn)]">Last used</span> : null}
        </div>
        <p className="mt-1 text-sm text-[color:var(--ss-text-secondary)]">{c.benefit}</p>

        <div className="mt-4 flex-1">
          <NumberedRows col={c.key} rows={c.rows} open={open} setOpen={setOpen} />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">{c.actions}</div>
      </div>
    </section>
  );
}

function AccentButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="ss-accent-btn ss-ring inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition-[filter]">
      {children}
    </button>
  );
}
function AccentOutline({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="ss-accent-outline ss-ring inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors">
      {children}
    </button>
  );
}

export function LandingScreen({ actions, returning = false, lastMode, theme = 'a' }: { actions: LandingActions; returning?: boolean; lastMode?: Col; theme?: LandingTheme }) {
  const [open, setOpen] = React.useState<OpenRow | null>(returning && lastMode ? { col: lastMode, row: 0 } : null);

  const columns: ColumnDef[] = [
    {
      key: 'session', title: 'SpeakSharp Session', benefit: 'Speak freely, capture your words, and review feedback without preparing an agenda.', Art: SessionPanelArt,
      rows: [
        { title: 'Choose your session mode', rollup: 'Your usual setup', subtasks: ['Pick how you want to capture — the modes you already use.'] },
        { title: 'Start speaking', rollup: 'Ready to record', subtasks: ['Speak as you normally would; SpeakSharp transcribes as you go.'] },
        { title: 'Review your feedback', rollup: 'Your usual feedback', subtasks: ['See your delivery feedback in the experience you know.'] },
      ],
      actions: <AccentButton onClick={actions.startSession}><Play size={15} aria-hidden /> Start a session</AccentButton>,
    },
    {
      key: 'exec', title: 'Executive Rehearsal', benefit: 'Practice against the outcomes you intend to cover.', Art: ExecPanelArt,
      rows: [
        { title: 'Prepare', rollup: '3 agenda points prepared', subtasks: ['Define the presentation or conversation.', 'Identify the audience and intended outcome.', 'Add 3–5 agenda points or use the prepared sample.'] },
        { title: 'Rehearse naturally', rollup: 'Agenda tracked passively', subtasks: ['Speak while your agenda is tracked passively.', 'Request help only if you want it — Pause or Finish anytime.'] },
        { title: 'Review and recover', rollup: 'Covered · recovered · next focus', subtasks: ['See what you covered, partly covered, missed, and recovered.', 'Inspect one suggested remedy, then rehearse again.'] },
      ],
      actions: (
        <>
          <AccentButton onClick={actions.startRehearsal}><Play size={15} aria-hidden /> Try a sample</AccentButton>
          <AccentOutline onClick={actions.createRehearsal}><PencilLine size={14} aria-hidden /> Create rehearsal</AccentOutline>
        </>
      ),
    },
  ];

  return (
    <div data-ss-theme={theme} className="min-h-screen bg-[color:var(--ss-canvas)]">
      {/* Integrated LIGHT hero — brand header + preamble in one expressive band (no dark navy bar) */}
      <div className="ss-theme-hero">
        <div className="mx-auto max-w-5xl px-5 pb-16 pt-5 sm:px-8">
          <div className="flex items-center gap-2.5">
            <FlaskConical size={20} aria-hidden style={{ color: 'var(--ss-exec-accent)' }} />
            <span className="mr-auto font-semibold text-[color:var(--ss-text)]">SpeakSharp</span>
            <span className="rounded-full border border-[color:var(--ss-border)] bg-white/70 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-[color:var(--ss-neutral)]">Sandbox</span>
          </div>
          <h2 className="mt-8 max-w-2xl text-3xl font-semibold tracking-tight text-[color:var(--ss-text)] sm:text-4xl">Choose how you want to practice</h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[color:var(--ss-text-secondary)]">
            {returning
              ? 'Welcome back — start a standard SpeakSharp session, or pick up your Executive Rehearsal.'
              : 'Start a standard SpeakSharp session for transcription and feedback, or prepare an Executive Rehearsal that quietly tracks the outcomes you intend to cover.'}
          </p>
        </div>
      </div>

      {/* Cards overlap the hero slightly so the header and choices read as one composition */}
      <div className="mx-auto -mt-10 max-w-5xl px-5 pb-12 sm:px-8">
        <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2">
          {columns.map((c) => <Card key={c.key} c={c} open={open} setOpen={setOpen} emphasize={returning && lastMode === c.key} />)}
        </div>

        {/* Review My Progress — subordinate, not a practice choice */}
        <div className="mt-7 text-center">
          <button onClick={actions.reviewProgress} className="ss-ring inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-[color:var(--ss-text-secondary)] transition-colors hover:text-[color:var(--ss-primary)]">
            View past progress <ArrowRight size={15} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
