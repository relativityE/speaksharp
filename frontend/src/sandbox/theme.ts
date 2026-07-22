/**
 * Phase 2 SANDBOX premium theme — a calm, premium "executive rehearsal cockpit".
 *
 * Deep navy/midnight framing, a warm-white primary surface, a restrained indigo action accent, and
 * teal/emerald (covered / progress / recovery), amber (partly addressed), slate (not yet addressed).
 * Red is reserved for post-session review only. Built on Tailwind's built-in palettes + a couple of
 * arbitrary warm-white values; committed to a single polished light-surface look (no theme toggle).
 *
 * These are className fragments used across the journey so the visual language stays consistent.
 */

export const T = {
  // Framing
  frame: 'bg-slate-900', // deep navy / midnight — outer frame, app bar, rehearsal cockpit
  frameText: 'text-slate-100',
  frameSubtle: 'text-slate-400',

  // Primary content surface (warm white, not utility gray)
  surface: 'bg-[#faf8f4]',
  ink: 'text-slate-900',
  body: 'text-slate-700',
  subtle: 'text-slate-500',
  faint: 'text-slate-400',

  // Actions — restrained indigo / electric blue
  primaryBtn:
    'inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 disabled:opacity-50',
  secondaryBtn:
    'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
  ghostBtn:
    'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',

  // Agenda coverage states (icon + text + color; never color alone)
  covered: { dot: 'text-emerald-600', chip: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' },
  partial: { dot: 'text-amber-500', chip: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200' },
  notAddressed: { dot: 'text-slate-400', chip: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200' },
  recovered: { dot: 'text-teal-600', chip: 'bg-teal-50 text-teal-800 ring-1 ring-teal-200' },

  progressBar: 'bg-emerald-500',
} as const;

export type AgendaVisualState = 'not_addressed' | 'partial' | 'covered' | 'recovered';
