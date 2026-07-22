/**
 * Phase 2 SANDBOX category vignettes — small, product-meaningful SVG illustrations (no stock art,
 * avatars, or decorative imagery). Each hints at what its activity does. Colors come from the theme
 * palette. Purely presentational; aria-hidden (the card title/benefit carry the accessible meaning).
 */

import React from 'react';

// Light Theme A tile (no navy) — token-driven so it stays coherent across the sandbox.
const wrap = 'h-16 w-16 shrink-0 rounded-xl bg-[color:var(--ss-primary-soft)] ring-1 ring-[color:var(--ss-border)]';

/** Quick Practice — a free-form waveform (speaking without an agenda). */
export function QuickPracticeVignette() {
  const bars = [10, 22, 14, 30, 18, 26, 12, 20];
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={`${wrap}`}>
      {bars.map((h, i) => (
        <rect key={i} x={6 + i * 6.6} y={32 - h / 2} width={3.4} height={h} rx={1.7} fill="var(--ss-listening)" opacity={0.62 + (i % 3) * 0.15} />
      ))}
    </svg>
  );
}

/** Executive Rehearsal — a mini agenda rail (covered / partial / not-addressed dots). */
export function ExecutiveRehearsalVignette() {
  const rows = [
    { c: 'var(--ss-success)', w: 30 }, // covered
    { c: 'var(--ss-partial)', w: 24 }, // partial
    { c: 'var(--ss-listening)', w: 27 }, // recovered
    { c: 'var(--ss-neutral)', w: 20 }, // not addressed
  ];
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={`${wrap}`}>
      {rows.map((r, i) => (
        <g key={i}>
          <circle cx={12} cy={13 + i * 13} r={4} fill={r.c} />
          <rect x={22} y={11 + i * 13} width={r.w} height={4.5} rx={2.25} fill={r.c} opacity={0.55} />
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

/**
 * Quick Practice — INTENT: speak freely → get a transcript + feedback. A flowing waveform on the left
 * resolves into transcript lines with a delivery-feedback check on the right (waveform → transcript).
 */
export function QuickPracticeArt({ emphasis = false }: { emphasis?: boolean }) {
  const heights = [14, 26, 20, 38, 30, 46, 34, 52, 40, 30, 44, 24]; // waveform (left ~55%)
  const warmAt = new Set([5, 9]);
  const lines = [128, 96, 112]; // transcript line widths (right)
  return (
    <svg viewBox="0 0 320 120" aria-hidden className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <line x1="16" y1="60" x2="150" y2="60" stroke="var(--ss-card)" strokeOpacity="0.22" strokeWidth="1.5" />
      {heights.map((h, i) => {
        const x = 18 + i * 11.4;
        const fill = warmAt.has(i) ? 'var(--ss-card-warm)' : 'var(--ss-card)';
        const op = warmAt.has(i) ? 1 : 0.5 + (i % 4) * 0.16 + (emphasis ? 0.12 : 0);
        return <rect key={i} x={x} y={60 - h / 2} width={5.5} height={h} rx={2.75} fill={fill} opacity={Math.min(op, 1)} />;
      })}
      {/* arrow: waveform → transcript */}
      <path d="M162 60 h16 m0 0 l-5 -4 m5 4 l-5 4" fill="none" stroke="var(--ss-card)" strokeOpacity="0.5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {lines.map((w, i) => (
        <rect key={i} x={190} y={38 + i * 16} width={w} height={8} rx={4} fill="var(--ss-card)" opacity={i === 0 ? 0.5 : 0.28} />
      ))}
      {/* delivery-feedback check */}
      <circle cx={196} cy={92} r={9} fill="var(--ss-card)" opacity={emphasis ? 1 : 0.9} />
      <path d="M191.5 92 l3 3 l6 -6.5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Guided Rehearsal — INTENT: prepare points → SpeakSharp tracks whether you cover them. Agenda points
 * on the left resolve into coverage outcomes on the right (covered / partly / recovered / open).
 */
export function GuidedRehearsalArt({ emphasis = false }: { emphasis?: boolean }) {
  const rows = [
    { c: 'var(--ss-success)', w: 150, glyph: 'check' }, // covered
    { c: 'var(--ss-partial)', w: 116, glyph: 'half' }, // partly addressed
    { c: 'var(--ss-card)', w: 132, glyph: 'star' }, // recovered (card accent)
    { c: 'var(--ss-neutral)', w: 92, glyph: 'open' }, // not yet addressed
  ];
  return (
    <svg viewBox="0 0 320 120" aria-hidden className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      {rows.map((r, i) => {
        const y = 20 + i * 24;
        const solid = r.glyph !== 'open';
        return (
          <g key={i}>
            {solid
              ? <circle cx={24} cy={y} r={6} fill={r.c} opacity={emphasis ? 1 : 0.95} />
              : <circle cx={24} cy={y} r={5.5} fill="none" stroke={r.c} strokeWidth="1.6" opacity={0.9} />}
            {r.glyph === 'check' ? <path d={`M20.5 ${y} l2.4 2.4 l4.6 -5`} fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /> : null}
            {r.glyph === 'star' ? <path d={`M24 ${y - 3.2} l1 2.2 l2.4 .3 l-1.7 1.7 l.4 2.4 l-2.1 -1.1 l-2.1 1.1 l.4 -2.4 l-1.7 -1.7 l2.4 -.3 z`} fill="#fff" opacity="0.95" /> : null}
            <rect x={40} y={y - 4} width={r.w} height={8} rx={4} fill={r.c} opacity={0.34} />
            <rect x={40 + r.w + 8} y={y - 4} width={40} height={8} rx={4} fill="var(--ss-card)" opacity={0.15} />
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
      <polyline points="8,44 20,38 30,42 42,26 56,16" fill="none" stroke="var(--ss-primary)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={56} cy={16} r={4} fill="var(--ss-primary)" />
      <line x1={8} y1={52} x2={56} y2={52} stroke="var(--ss-neutral)" strokeWidth={2} />
    </svg>
  );
}
