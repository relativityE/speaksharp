/**
 * Phase 2 SANDBOX category vignettes — small, product-meaningful SVG illustrations (no stock art,
 * avatars, or decorative imagery). Each hints at what its activity does. Colors come from the theme
 * palette. Purely presentational; aria-hidden (the card title/benefit carry the accessible meaning).
 */

import React from 'react';

const wrap = 'h-16 w-16 shrink-0 rounded-xl ss-hero-solid';

/** Quick Practice — a free-form waveform (speaking without an agenda). */
export function QuickPracticeVignette() {
  const bars = [10, 22, 14, 30, 18, 26, 12, 20];
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={`${wrap}`}>
      {bars.map((h, i) => (
        <rect key={i} x={6 + i * 6.6} y={32 - h / 2} width={3.4} height={h} rx={1.7} fill="#2dd4bf" opacity={0.55 + (i % 3) * 0.15} />
      ))}
    </svg>
  );
}

/** Executive Rehearsal — a mini agenda rail (covered / partial / not-addressed dots). */
export function ExecutiveRehearsalVignette() {
  const rows = [
    { c: '#10b981', w: 30 }, // covered
    { c: '#f59e0b', w: 24 }, // partial
    { c: '#14b8a6', w: 27 }, // recovered
    { c: '#64748b', w: 20 }, // not addressed
  ];
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={`${wrap}`}>
      {rows.map((r, i) => (
        <g key={i}>
          <circle cx={12} cy={13 + i * 13} r={4} fill={r.c} />
          <rect x={22} y={11 + i * 13} width={r.w} height={4.5} rx={2.25} fill={r.c} opacity={0.5} />
        </g>
      ))}
    </svg>
  );
}

/*
 * ── Substantial card visual panels (landing theme-comparison gate) ────────────────────────────────
 * Full-width illustrated regions (not 64px utility icons). They read the per-card accent from CSS
 * custom properties (--ss-card / --ss-card-warm) set on the card, so they recolor per theme AND
 * distinguish the two choices. Purely presentational (aria-hidden); the card title/benefit carry
 * meaning. No stock art, avatars, mascots, or confetti — abstract waveform / agenda compositions only.
 */

/** SpeakSharp Session — a broad, flowing speech waveform (speaking in the live experience). */
export function SessionPanelArt({ emphasis = false }: { emphasis?: boolean }) {
  // Deterministic bar heights (no RNG) — a natural-looking cadence across the panel width.
  const heights = [14, 26, 20, 38, 30, 46, 34, 52, 40, 30, 44, 24, 36, 22, 30, 18, 26, 16, 22, 12];
  const warmAt = new Set([5, 12]); // a couple of warm-accent peaks for energy
  return (
    <svg viewBox="0 0 320 120" aria-hidden className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <line x1="16" y1="60" x2="304" y2="60" stroke="var(--ss-card)" strokeOpacity="0.18" strokeWidth="1.5" />
      {heights.map((h, i) => {
        const x = 18 + i * 14.4;
        const fill = warmAt.has(i) ? 'var(--ss-card-warm)' : 'var(--ss-card)';
        const op = warmAt.has(i) ? 0.95 : 0.35 + (i % 4) * 0.16 + (emphasis ? 0.12 : 0);
        return <rect key={i} x={x} y={60 - h / 2} width={6} height={h} rx={3} fill={fill} opacity={Math.min(op, 1)} />;
      })}
    </svg>
  );
}

/** Executive Rehearsal — an agenda rail with coverage states (covered / partial / recovered / open). */
export function ExecPanelArt({ emphasis = false }: { emphasis?: boolean }) {
  const rows = [
    { c: 'var(--ss-success)', w: 150 }, // covered
    { c: 'var(--ss-partial)', w: 116 }, // partly addressed
    { c: 'var(--ss-card)', w: 132 }, // recovered (card accent)
    { c: 'var(--ss-neutral)', w: 92 }, // not yet addressed
  ];
  return (
    <svg viewBox="0 0 320 120" aria-hidden className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      {rows.map((r, i) => {
        const y = 20 + i * 24;
        return (
          <g key={i}>
            <circle cx={24} cy={y} r={6} fill={r.c} opacity={emphasis ? 1 : 0.9} />
            <rect x={40} y={y - 4} width={r.w} height={8} rx={4} fill={r.c} opacity={0.28} />
            <rect x={40 + r.w + 8} y={y - 4} width={40} height={8} rx={4} fill="var(--ss-card)" opacity={0.12} />
          </g>
        );
      })}
    </svg>
  );
}

/** Review My Progress — an upward trend sparkline. */
export function ReviewProgressVignette() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={`${wrap}`}>
      <polyline points="8,44 20,38 30,42 42,26 56,16" fill="none" stroke="#818cf8" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={56} cy={16} r={4} fill="#818cf8" />
      <line x1={8} y1={52} x2={56} y2={52} stroke="#334155" strokeWidth={2} />
    </svg>
  );
}
