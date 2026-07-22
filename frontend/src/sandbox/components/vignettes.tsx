/**
 * Phase 2 SANDBOX category vignettes — small, product-meaningful SVG illustrations (no stock art,
 * avatars, or decorative imagery). Each hints at what its activity does. Colors come from the theme
 * palette. Purely presentational; aria-hidden (the card title/benefit carry the accessible meaning).
 */

import React from 'react';

const wrap = 'h-16 w-16 shrink-0 rounded-xl';

/** Quick Practice — a free-form waveform (speaking without an agenda). */
export function QuickPracticeVignette() {
  const bars = [10, 22, 14, 30, 18, 26, 12, 20];
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={`${wrap} bg-slate-800`}>
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
    <svg viewBox="0 0 64 64" aria-hidden className={`${wrap} bg-slate-800`}>
      {rows.map((r, i) => (
        <g key={i}>
          <circle cx={12} cy={13 + i * 13} r={4} fill={r.c} />
          <rect x={22} y={11 + i * 13} width={r.w} height={4.5} rx={2.25} fill={r.c} opacity={0.5} />
        </g>
      ))}
    </svg>
  );
}

/** Review My Progress — an upward trend sparkline. */
export function ReviewProgressVignette() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={`${wrap} bg-slate-800`}>
      <polyline points="8,44 20,38 30,42 42,26 56,16" fill="none" stroke="#818cf8" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={56} cy={16} r={4} fill="#818cf8" />
      <line x1={8} y1={52} x2={56} y2={52} stroke="#334155" strokeWidth={2} />
    </svg>
  );
}
