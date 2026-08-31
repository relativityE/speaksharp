#!/usr/bin/env node
/**
 * PAIRED BOOTSTRAP over a browser-matrix artifact's per-utterance rows.
 *
 * Pooled WER = Sum(S+D+I) / Sum(refWords) — the same statistic the artifact reports, so this analysis
 * cannot drift from the scorer by using a different definition.
 *
 * PAIRED, because the arms decode the SAME utterances: resampling utterance ids and scoring every arm
 * on the identical resample removes between-utterance variance, which is far larger than the
 * between-model difference being measured. An unpaired bootstrap over these numbers would report much
 * wider intervals and could not distinguish any pair.
 *
 * DETERMINISTIC. mulberry32 seeded from a constant, so the reported interval is reproducible byte for
 * byte rather than being a number nobody can re-derive.
 *
 *   usage: node scripts/analysis/paired-bootstrap.mjs <artifact.json> [resamples] [seedHex]
 */
import { readFileSync } from 'node:fs';
const art = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const arms = art.results.filter((r) => r.reliability?.decoded);
const byId = new Map(arms.map((a) => [a.id, new Map(a.perUtterance.map((u) => [u.id, u]))]));
const ids = [...byId.get(arms[0].id).keys()].filter((id) => arms.every((a) => byId.get(a.id).has(id)));

const pooled = (armId, sample) => {
  const m = byId.get(armId);
  let e = 0, w = 0;
  for (const id of sample) { const u = m.get(id); e += u.substitutions + u.deletions + u.insertions; w += u.referenceWords; }
  return e / w;
};

// mulberry32 — deterministic, seeded, so this run is reproducible.
let seed = Number(process.argv[4] ?? 0x1304600);
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const N = Number(process.argv[3] ?? 10000);
console.log(`paired bootstrap: ${ids.length} utterances, ${N} resamples, seed 0x${Number(process.argv[4] ?? 0x1304600).toString(16)}\n`);
for (const a of arms) console.log(`  ${a.id.padEnd(30)} pooled WER ${pooled(a.id, ids).toFixed(5)}`);
console.log();

const pairs = [];
for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) pairs.push([arms[i].id, arms[j].id]);

for (const [A, B] of pairs) {
  const obs = pooled(A, ids) - pooled(B, ids);
  const diffs = [];
  for (let n = 0; n < N; n++) {
    const s = new Array(ids.length);
    for (let k = 0; k < ids.length; k++) s[k] = ids[(rnd() * ids.length) | 0];
    diffs.push(pooled(A, s) - pooled(B, s));
  }
  diffs.sort((x, y) => x - y);
  const lo = diffs[Math.floor(0.025 * N)], hi = diffs[Math.floor(0.975 * N)];
  // two-sided p: proportion of resamples on the other side of zero
  const neg = diffs.filter((d) => d <= 0).length / N;
  const p = 2 * Math.min(neg, 1 - neg);
  const verdict = (lo > 0 || hi < 0) ? 'DISTINGUISHABLE' : 'not distinguishable';
  console.log(`${A}  vs  ${B}`);
  console.log(`   diff ${obs >= 0 ? '+' : ''}${obs.toFixed(5)}  95% CI [${lo.toFixed(5)}, ${hi.toFixed(5)}]  p~${p.toFixed(3)}  ${verdict}`);
}
