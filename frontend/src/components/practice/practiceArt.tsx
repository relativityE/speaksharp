/**
 * Practice-entry illustrations — hand-authored SVG (no stock art/avatars/external assets). They read
 * per-card accent CSS vars so Quick renders teal, Guided renders violet. aria-hidden (titles carry
 * meaning). Ported from the accepted #1017 design.
 */

import React from 'react';

/** Overall-landing shared graphic: one amber voice BRANCHING into teal (Quick) and violet (Guided). */
export function LandingHeroArt() {
  return (
    <svg viewBox="0 0 320 200" aria-hidden className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      {[26, 44, 34, 58, 40, 30].map((h, i) => (
        <rect key={i} x={14 + i * 11} y={100 - h / 2} width={6} height={h} rx={3} fill="var(--ss-amber)" opacity={0.45 + (i % 3) * 0.2} />
      ))}
      <circle cx={92} cy={100} r={7} fill="var(--ss-amber)" />
      <path d="M99 100 C 140 100, 150 54, 196 54" fill="none" stroke="var(--ss-session-accent)" strokeWidth="2.5" strokeOpacity="0.5" strokeLinecap="round" />
      {[150, 120, 138].map((w, i) => (
        <rect key={`q${i}`} x={206} y={40 + i * 14} width={w * 0.5} height={7} rx={3.5} fill="var(--ss-session-accent)" opacity={i === 0 ? 0.55 : 0.3} />
      ))}
      <circle cx={212} cy={40} r={8} fill="var(--ss-session-accent)" />
      <path d="M207.5 40 l3 3 l6 -6.5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M99 100 C 140 100, 150 148, 196 148" fill="none" stroke="var(--ss-exec-accent)" strokeWidth="2.5" strokeOpacity="0.5" strokeLinecap="round" />
      {[
        { c: 'var(--ss-success)', y: 132 },
        { c: 'var(--ss-exec-accent)', y: 150 },
        { c: 'var(--ss-partial)', y: 168 },
      ].map((r, i) => (
        <g key={`g${i}`}>
          <circle cx={212} cy={r.y} r={6} fill={r.c} />
          <rect x={226} y={r.y - 3.5} width={70 - i * 12} height={7} rx={3.5} fill={r.c} opacity={0.32} />
        </g>
      ))}
    </svg>
  );
}

/** Quick Practice — waveform → transcript → delivery-feedback check. */
export function QuickPracticeArt({ emphasis = false }: { emphasis?: boolean }) {
  const heights = [14, 26, 20, 38, 30, 46, 34, 52, 40, 30, 44, 24];
  const warmAt = new Set([5, 9]);
  const lines = [128, 96, 112];
  return (
    <svg viewBox="0 0 320 120" aria-hidden className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <line x1="16" y1="60" x2="150" y2="60" stroke="var(--ss-card)" strokeOpacity="0.22" strokeWidth="1.5" />
      {heights.map((h, i) => {
        const x = 18 + i * 11.4;
        const fill = warmAt.has(i) ? 'var(--ss-card-warm)' : 'var(--ss-card)';
        const op = warmAt.has(i) ? 1 : 0.5 + (i % 4) * 0.16 + (emphasis ? 0.12 : 0);
        return <rect key={i} x={x} y={60 - h / 2} width={5.5} height={h} rx={2.75} fill={fill} opacity={Math.min(op, 1)} />;
      })}
      <path d="M162 60 h16 m0 0 l-5 -4 m5 4 l-5 4" fill="none" stroke="var(--ss-card)" strokeOpacity="0.5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {lines.map((w, i) => (
        <rect key={i} x={190} y={38 + i * 16} width={w} height={8} rx={4} fill="var(--ss-card)" opacity={i === 0 ? 0.5 : 0.28} />
      ))}
      <circle cx={196} cy={92} r={9} fill="var(--ss-card)" opacity={emphasis ? 1 : 0.9} />
      <path d="M191.5 92 l3 3 l6 -6.5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Guided Rehearsal — agenda points → covered / partly / recovered / open outcomes. */
export function GuidedRehearsalArt({ emphasis = false }: { emphasis?: boolean }) {
  const rows = [
    { c: 'var(--ss-success)', w: 150, glyph: 'check' },
    { c: 'var(--ss-partial)', w: 116, glyph: 'half' },
    { c: 'var(--ss-card)', w: 132, glyph: 'star' },
    { c: 'var(--ss-neutral)', w: 92, glyph: 'open' },
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
