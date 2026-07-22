/**
 * Phase 2 SANDBOX theme fragments — "Confident Momentum" (tokens live in sandbox.css).
 *
 * ~60% warm ivory/white, ~25% navy/ink, ~10% cobalt/teal, ~5% semantic status. Cobalt + teal are the
 * shared action/brand language; amber/emerald/slate/red carry state meaning only. State meaning is
 * always color + icon + text. `.ss-ring` gives an all-surface focus outline.
 */

export const T = {
  // Framing
  hero: 'ss-hero-bg', // navy gradient — welcome/header region only
  heroSolid: 'ss-hero-solid',
  heroText: 'text-white',
  heroSubtle: 'text-slate-300',
  canvas: 'ss-canvas', // warm ivory page canvas
  surface: 'bg-white',

  // Text
  ink: 'text-[color:var(--ss-text)]',
  body: 'text-[color:var(--ss-text-secondary)]',
  subtle: 'text-[color:var(--ss-neutral)]',
  border: 'border-[color:var(--ss-border)]',

  // Actions — cobalt primary, restrained secondary/ghost
  primaryBtn:
    'ss-ring inline-flex items-center justify-center gap-2 rounded-xl bg-[color:var(--ss-primary)] px-5 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-[color:var(--ss-primary-hover)] disabled:opacity-50',
  secondaryBtn:
    'ss-ring inline-flex items-center justify-center gap-2 rounded-xl border border-[color:var(--ss-border)] bg-white px-4 py-2.5 text-sm font-semibold text-[color:var(--ss-text-secondary)] transition-colors hover:bg-[color:var(--ss-canvas)]',
  ghostBtn:
    'ss-ring inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-[color:var(--ss-primary)] transition-colors hover:bg-[color:var(--ss-primary-soft)]',

  // Agenda / progress states (soft bg + dark text; dot color for the glyph)
  covered: { dot: 'text-[color:var(--ss-success)]', chip: 'bg-[color:var(--ss-success-soft)] text-[color:var(--ss-success-text)]' },
  partial: { dot: 'text-[color:var(--ss-partial)]', chip: 'bg-[color:var(--ss-partial-soft)] text-[color:var(--ss-partial-text)]' },
  notAddressed: { dot: 'text-[color:var(--ss-neutral)]', chip: 'bg-[color:var(--ss-neutral-soft)] text-[color:var(--ss-neutral-text)]' },
  recovered: { dot: 'text-[color:var(--ss-listening)]', chip: 'bg-[color:var(--ss-listening-soft)] text-[color:var(--ss-listening-text)]' },
  setback: { dot: 'text-[color:var(--ss-setback)]', chip: 'bg-[color:var(--ss-setback-soft)] text-[color:var(--ss-setback-text)]' },

  progressBar: 'bg-[color:var(--ss-success)]',
} as const;

export type AgendaVisualState = 'not_addressed' | 'partial' | 'covered' | 'recovered';
