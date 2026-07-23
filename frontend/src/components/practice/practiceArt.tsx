/**
 * Practice-entry illustrations — hand-authored SVG (no stock art/avatars/external assets). They read
 * per-card accent CSS vars so Quick renders teal, Guided renders violet. aria-hidden (titles carry
 * meaning). Ported from the accepted #1017 design.
 */

import React from 'react';

/**
 * Overall-landing shared graphic: one bold ORANGE voice (the SpeakSharp brand through-line) BRANCHING
 * into the teal (Quick) and violet (Guided) practice paths. Deliberately bold — strong line weights and
 * solid nodes so the "one voice → two ways to practice" idea reads instantly, without any caption.
 */
export function LandingHeroArt() {
  return (
    <svg viewBox="0 0 320 200" aria-hidden className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      {/* Orange voice waveform — the brand source. Bolder bars, full-strength brand orange. */}
      {[30, 52, 40, 68, 46, 34].map((h, i) => (
        <rect key={i} x={12 + i * 12} y={100 - h / 2} width={7.5} height={h} rx={3.75} fill="var(--ss-amber)" opacity={0.6 + (i % 3) * 0.2} />
      ))}
      <circle cx={96} cy={100} r={10} fill="var(--ss-amber)" />
      <circle cx={96} cy={100} r={10} fill="none" stroke="var(--ss-amber)" strokeWidth="3" strokeOpacity="0.25" />

      {/* Teal branch → Quick Practice (transcript lines + a completed check). */}
      <path d="M106 100 C 148 100, 158 52, 200 52" fill="none" stroke="var(--ss-session-accent)" strokeWidth="4" strokeOpacity="0.85" strokeLinecap="round" />
      {[150, 120, 138].map((w, i) => (
        <rect key={`q${i}`} x={216} y={38 + i * 14} width={w * 0.52} height={8} rx={4} fill="var(--ss-session-accent)" opacity={i === 0 ? 0.7 : 0.4} />
      ))}
      <circle cx={204} cy={38} r={10} fill="var(--ss-session-accent)" />
      <path d="M198.5 38 l3.6 3.6 l7 -7.6" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />

      {/* Violet branch → Guided Rehearsal (agenda outcomes: covered / partial / open). */}
      <path d="M106 100 C 148 100, 158 150, 200 150" fill="none" stroke="var(--ss-exec-accent)" strokeWidth="4" strokeOpacity="0.85" strokeLinecap="round" />
      {[
        { c: 'var(--ss-success)', y: 132 },
        { c: 'var(--ss-exec-accent)', y: 152 },
        { c: 'var(--ss-partial)', y: 172 },
      ].map((r, i) => (
        <g key={`g${i}`}>
          <circle cx={204} cy={r.y} r={8} fill={r.c} />
          <rect x={220} y={r.y - 4} width={78 - i * 14} height={8} rx={4} fill={r.c} opacity={0.42} />
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
