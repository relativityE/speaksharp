#!/usr/bin/env node
/**
 * #1837 — REFRESH THE UNIT SHARD SCHEDULING HINTS FROM A REAL CI RUN.
 *
 * Reads every `shard-<n>/unit-file-timings.json` in a downloaded `unit-artifacts` directory (written by
 * scripts/vitest-ci-reporter.mjs) and rewrites scripts/ci-unit-durations.json, which
 * scripts/ci-duration-sequencer.mjs uses to balance shards.
 *
 * These numbers are scheduling hints only. They never decide WHICH tests run: the sequencer partitions
 * whatever Vitest discovers, and scripts/ci-unit-partition-check.mjs fails the run unless every
 * discovered file executed exactly once. Stale or missing hints can only cost balance, never coverage.
 *
 * Usage:
 *   node scripts/ci-unit-durations-refresh.mjs <coverage-dir> --repository owner/name --commit <40-hex> \
 *     --run-id <id> [--out scripts/ci-unit-durations.json]
 *   node scripts/ci-unit-durations-refresh.mjs --combine <out.json> <refreshed.json> <refreshed.json>...
 *
 * `--combine` averages refreshed hint files from several real runs. One run's per-file cost swings 20-30% for
 * the heavy database integration files, so hints from a single run balance that run and not the next one.
 */
import fs from 'node:fs';
import path from 'node:path';

const MAX_MS = 3_600_000;

/**
 * @param {Array<{ shard: number, record: any }>} shards
 * @returns {Record<string, number>} path -> measured ms, sorted by path for stable diffs
 */
export function durationsFromShards(shards) {
  const durations = {};
  for (const { shard, record } of shards) {
    if (!record || record.schemaVersion !== 1 || record.kind !== 'vitest-executed-files' || !Array.isArray(record.files)) {
      throw new Error(`shard-${shard}: unit-file-timings.json missing or malformed`);
    }
    for (const entry of record.files) {
      if (typeof entry?.path !== 'string' || entry.path === '' || entry.path.startsWith('../')) {
        throw new Error(`shard-${shard}: malformed file entry`);
      }
      if (Object.prototype.hasOwnProperty.call(durations, entry.path)) {
        throw new Error(`${entry.path} reported by more than one shard`);
      }
      // A file that failed or recorded no cost is left out; the sequencer gives it the median estimate.
      if (entry.state === 'pass' && Number.isFinite(entry.durationMs) && entry.durationMs > 0 && entry.durationMs <= MAX_MS) {
        durations[entry.path] = Math.round(entry.durationMs);
      }
    }
  }
  return Object.fromEntries(Object.entries(durations).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Mean per-file cost across refreshed hint receipts. A file measured in only some runs is averaged over those.
 * @param {Array<any>} receipts parsed refreshed hint files (schemaVersion 1, one source run each)
 */
export function combineDurationReceipts(receipts) {
  if (!Array.isArray(receipts) || receipts.length < 2) throw new Error('combine needs at least two refreshed hint files');
  const sums = new Map();
  const runs = [];
  for (const receipt of receipts) {
    const source = receipt?.source;
    if (receipt?.schemaVersion !== 1 || !receipt.durationsMs || typeof receipt.durationsMs !== 'object' || Array.isArray(receipt.durationsMs)
      || !Number.isSafeInteger(source?.runId) || !/^[0-9a-f]{40}$/.test(source?.commit ?? '') || typeof source?.repository !== 'string') {
      throw new Error('malformed refreshed hint file');
    }
    if (runs.some((run) => run.runId === source.runId)) throw new Error(`run ${source.runId} combined twice`);
    if (runs.length && source.repository !== runs[0].repository) throw new Error('hint files from different repositories');
    runs.push({ repository: source.repository, runId: source.runId, commit: source.commit });
    for (const [file, ms] of Object.entries(receipt.durationsMs)) {
      if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_MS) continue;
      const entry = sums.get(file) ?? { total: 0, count: 0 };
      entry.total += ms;
      entry.count += 1;
      sums.set(file, entry);
    }
  }
  const durationsMs = Object.fromEntries([...sums.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((file) => [file, Math.round(sums.get(file).total / sums.get(file).count)]));
  return {
    schemaVersion: 1,
    source: {
      repository: runs[0].repository,
      runs: runs.map(({ runId, commit }) => ({ runId, commit })),
      basis: 'Mean per-file Vitest wall cost (prepare + environment + setup + collect + tests) across the listed runs; scheduling hints only, never execution evidence',
    },
    durationsMs,
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''));
if (isMain && process.argv[2] === '--combine') {
  const [out, ...inputs] = process.argv.slice(3);
  if (!out || inputs.length < 2) {
    console.error('usage: ci-unit-durations-refresh.mjs --combine <out.json> <refreshed.json> <refreshed.json>...');
    process.exit(2);
  }
  const combined = combineDurationReceipts(inputs.map((file) => JSON.parse(fs.readFileSync(file, 'utf8'))));
  fs.writeFileSync(out, `${JSON.stringify(combined, null, 2)}\n`);
  console.log(`[duration-refresh] combined ${inputs.length} runs into ${Object.keys(combined.durationsMs).length} file durations at ${out}`);
} else if (isMain) {
  const args = process.argv.slice(2);
  const dir = args[0];
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const repository = flag('--repository');
  const commit = flag('--commit');
  const runId = Number(flag('--run-id'));
  const out = flag('--out') ?? 'scripts/ci-unit-durations.json';
  const shardCount = Number(process.env.UNIT_SHARDS || 4);
  if (!dir || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[0-9a-f]{40}$/.test(commit ?? '') || !Number.isSafeInteger(runId) || runId <= 0) {
    console.error('usage: ci-unit-durations-refresh.mjs <coverage-dir> --repository owner/name --commit <40-hex> --run-id <id> [--out file]');
    process.exit(2);
  }
  const shards = Array.from({ length: shardCount }, (_, i) => {
    const file = path.join(dir, `shard-${i + 1}`, 'unit-file-timings.json');
    let record = null;
    try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* reported below */ }
    return { shard: i + 1, record };
  });
  const durationsMs = durationsFromShards(shards);
  fs.writeFileSync(out, `${JSON.stringify({
    schemaVersion: 1,
    source: {
      repository,
      commit,
      runId,
      basis: 'Per-file Vitest wall cost (prepare + environment + setup + collect + tests) from unit-file-timings.json; scheduling hints only, never execution evidence',
    },
    durationsMs,
  }, null, 2)}\n`);
  console.log(`[duration-refresh] wrote ${Object.keys(durationsMs).length} file durations to ${out}`);
  // Measured cost per shard (sum of per-file wall cost; workers run files in parallel, so this is work, not wall).
  const totals = shards.map(({ shard, record }) => ({ shard, files: record.files.length,
    seconds: Math.round(record.files.reduce((sum, f) => sum + (Number.isFinite(f.durationMs) ? f.durationMs : 0), 0) / 1000) }));
  const secs = totals.map((t) => t.seconds);
  console.log(`[duration-refresh] measured per-shard work: ${totals.map((t) => `shard-${t.shard} ${t.files} files ${t.seconds}s`).join(', ')}; spread ${Math.max(...secs) - Math.min(...secs)}s`);
}
