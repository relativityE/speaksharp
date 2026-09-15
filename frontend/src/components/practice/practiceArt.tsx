/**
 * Practice-entry illustrations — hand-authored SVG (no stock art/avatars/external assets). They read
 * per-card accent CSS vars so each card renders in its own identity. aria-hidden (titles carry
 * meaning). Ported from the accepted #1017 design; colours are the shared #1480 roles.
 */

import React from 'react';

/**
 * Overall-landing shared graphic: one bold SIGNATURE voice (the SpeakSharp brand through-line) BRANCHING
 * into the practice paths. Deliberately bold — strong line weights and solid nodes so the "one voice → two
 * ways to practice" idea reads instantly, without any caption. Landing route: no Focus purple.
 */
export function LandingHeroArt() {
  return (
    <svg viewBox="0 0 320 200" aria-hidden className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      {/* Straight voice bars — alternating signature / ink (the brand source signal). */}
      {[38, 74, 104, 62, 88, 46].map((h, i) => (
        <rect key={i} x={12 + i * 12} y={85 - h / 2} width={6} height={h} rx={3} fill={i % 2 === 0 ? 'var(--brand-signature)' : 'var(--brand-ink)'} />
      ))}
      {/* Junction dot with a soft ring. */}
      <circle cx={100} cy={85} r={13.5} fill="rgba(255,182,31,0.2)" />
      <circle cx={100} cy={85} r={7.5} fill="var(--brand-signature)" />
      {/* Three flat result rows: covered (status + check) / in-progress (ink) / open (signature). */}
      {[
        { c: 'var(--brand-status)', check: true },
        { c: 'var(--brand-ink-hairline)', check: false },
        { c: 'var(--brand-signature)', check: false },
      ].map((r, i) => {
        const y = 49 + i * 36;
        return (
          <g key={`r${i}`}>
            <circle cx={144} cy={y} r={8} fill={r.c} />
            {r.check && <path d={`M139.5 ${y} l3 3 l6 -6.5`} fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
            <rect x={162} y={y - 4} width={118 - i * 20} height={8} rx={4} fill={r.c} opacity={0.5} />
          </g>
        );
      })}
    </svg>
  );
}

/** Quick Practice — waveform → transcript → delivery-feedback check. Uses the card's INK
 * (`--ss-art-ink`) so it reads clearly on its band; warm bars stay signature. */
export function FreeformArt({ emphasis = false }: { emphasis?: boolean }) {
  const heights = [14, 26, 20, 38, 30, 46, 34, 52, 40, 30, 44, 24];
  const warmAt = new Set([5, 9]);
  const lines = [128, 96, 112];
  const ink = 'var(--ss-art-ink, var(--ss-card))';
  return (
    <svg viewBox="0 0 320 120" aria-hidden className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <line x1="16" y1="60" x2="150" y2="60" stroke={ink} strokeOpacity="0.3" strokeWidth="1.5" />
      {heights.map((h, i) => {
        const x = 18 + i * 11.4;
        const fill = warmAt.has(i) ? 'var(--ss-card-warm)' : ink;
        const op = warmAt.has(i) ? 1 : 0.72 + (i % 4) * 0.09 + (emphasis ? 0.08 : 0);
        return <rect key={i} x={x} y={60 - h / 2} width={5.5} height={h} rx={2.75} fill={fill} opacity={Math.min(op, 1)} />;
      })}
      <path d="M162 60 h16 m0 0 l-5 -4 m5 4 l-5 4" fill="none" stroke={ink} strokeOpacity="0.7" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {lines.map((w, i) => (
        <rect key={i} x={190} y={38 + i * 16} width={w} height={8} rx={4} fill={ink} opacity={i === 0 ? 0.7 : 0.45} />
      ))}
      <circle cx={196} cy={92} r={9} fill={ink} opacity={1} />
      <path d="M191.5 92 l3 3 l6 -6.5" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Focus Points — agenda points → covered / partly / recovered / open outcomes. Rendered LIGHT-on-dark
 * (light circles + ink glyphs + brighter bars) so every row reads clearly on the dark band. */
export function ObjectiveArt({ emphasis = false }: { emphasis?: boolean }) {
  const glyphInk = 'var(--brand-ink)'; // reads on the light circles that sit over the dark band
  const rows = [
    { c: 'var(--brand-success-border)', w: 150, glyph: 'check' }, // covered = light success
    { c: 'var(--brand-signature)', w: 116, glyph: 'half' },       // partial = signature
    { c: 'white', w: 132, glyph: 'star' },                         // rehearsed = white
    { c: 'var(--brand-neutral-border)', w: 92, glyph: 'open' },   // open = light neutral outline
  ];
  return (
    <svg viewBox="0 0 320 120" aria-hidden className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      {rows.map((r, i) => {
        const y = 20 + i * 24;
        const solid = r.glyph !== 'open';
        return (
          <g key={i}>
            {solid
              ? <circle cx={24} cy={y} r={7} fill={r.c} opacity={1} />
              : <circle cx={24} cy={y} r={6.5} fill="none" stroke={r.c} strokeWidth="2" opacity={0.95} />}
            {r.glyph === 'check' ? <path d={`M20.4 ${y} l2.6 2.6 l4.9 -5.3`} fill="none" stroke={glyphInk} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /> : null}
            {r.glyph === 'star' ? <path d={`M24 ${y - 3.4} l1.05 2.3 l2.5 .3 l-1.8 1.8 l.45 2.5 l-2.2 -1.15 l-2.2 1.15 l.45 -2.5 l-1.8 -1.8 l2.5 -.3 z`} fill={glyphInk} /> : null}
            <rect x={40} y={y - 4} width={r.w} height={8} rx={4} fill={r.c} opacity={emphasis ? 0.68 : 0.6} />
            <rect x={40 + r.w + 8} y={y - 4} width={40} height={8} rx={4} fill="white" opacity={0.3} />
          </g>
        );
      })}
    </svg>
  );
}
