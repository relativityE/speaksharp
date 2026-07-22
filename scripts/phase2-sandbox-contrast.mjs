/**
 * Phase 2 SANDBOX contrast report — WCAG 2.1 AA for the "Confident Momentum" palette.
 * Pure computation, no I/O. Fails (exit 1) if any normal-text pair is below 4.5:1 or any
 * large-text/UI pair is below 3:1.
 */

const hexToRgb = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const L = (hex) => { const [r, g, b] = hexToRgb(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (fg, bg) => { const a = L(fg), b = L(bg); const hi = Math.max(a, b), lo = Math.min(a, b); return (hi + 0.05) / (lo + 0.05); };

// [name, fg, bg, minRatio, kind]
const PAIRS = [
  ['ink on canvas', '#0F172A', '#F8F7F3', 4.5, 'text'],
  ['secondary on canvas', '#475569', '#F8F7F3', 4.5, 'text'],
  ['ink on white', '#0F172A', '#FFFFFF', 4.5, 'text'],
  ['secondary on white', '#475569', '#FFFFFF', 4.5, 'text'],
  ['white on hero navy', '#FFFFFF', '#0B1530', 4.5, 'text'],
  ['white on hero-secondary', '#FFFFFF', '#1E3473', 4.5, 'text'],
  ['white on cobalt primary', '#FFFFFF', '#3155D9', 4.5, 'text'],
  ['white on cobalt hover', '#FFFFFF', '#243FA8', 4.5, 'text'],
  // NOTE: white text on solid teal is only ~3.74:1, so teal is used ONLY as a dot/glyph/soft-bg
  // (never as a white-text background). The "listening glyph on white" (UI, 3:1) pair below covers it.
  ['primary-soft text', '#243FA8', '#EEF2FF', 4.5, 'text'],
  ['listening-soft text', '#08665F', '#E5FBF7', 4.5, 'text'],
  ['success-soft text', '#065F46', '#DDF8EC', 4.5, 'text'],
  ['partial-soft text', '#7A4500', '#FFF3D6', 4.5, 'text'],
  ['neutral-soft text', '#334155', '#EEF2F7', 4.5, 'text'],
  ['setback-soft text', '#9B1C1C', '#FFF0EE', 4.5, 'text'],
  // Status glyphs/icons on white/ivory (UI, 3:1)
  ['success glyph on white', '#087A55', '#FFFFFF', 3.0, 'ui'],
  ['partial glyph on white', '#B96508', '#FFFFFF', 3.0, 'ui'],
  ['setback glyph on white', '#B42318', '#FFFFFF', 3.0, 'ui'],
  ['listening glyph on white', '#0D9488', '#FFFFFF', 3.0, 'ui'],
  ['primary glyph on white', '#3155D9', '#FFFFFF', 3.0, 'ui'],
  ['neutral glyph on canvas', '#64748B', '#F8F7F3', 3.0, 'ui'],
  ['border on canvas', '#D7DEE8', '#F8F7F3', 1.0, 'ui'], // decorative divider, no min
];

let fail = 0;
console.log('WCAG AA contrast report — Confident Momentum\n');
for (const [name, fg, bg, min, kind] of PAIRS) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}:1  (min ${min})  ${kind.padEnd(4)}  ${name}  [${fg} on ${bg}]`);
}
console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAIL`}`);
process.exit(fail === 0 ? 0 : 1);
