#!/usr/bin/env node
/**
 * #1837 — PROVE THE UNIT SHARDS TOGETHER EXECUTED EVERY DISCOVERED TEST FILE EXACTLY ONCE. FAIL CLOSED.
 *
 * Unit shards are now partitioned by measured duration (scripts/ci-duration-sequencer.mjs) instead of
 * Vitest's built-in hash split. A partition that dropped or duplicated a file would still let every shard
 * pass, and coverage could still clear its thresholds, so the shard results alone cannot show the suite
 * ran. This check compares two independent records of the same checkout:
 *
 *   - the files Vitest DISCOVERS (`vitest list --filesOnly --json`, same config, same commit), and
 *   - the files each shard's reporter says it EXECUTED (`unit-file-timings.json`, scripts/vitest-ci-reporter.mjs).
 *
 * Every discovered file must appear in exactly one shard, no shard may report a file that was not
 * discovered, and every expected shard must supply a well-formed record. Anything else is rejected.
 *
 * The decision is pure (`checkPartition`) so each rejection path is unit-tested without a CI cycle.
 */
import fs from 'node:fs';
import path from 'node:path';

export const PARTITION_HOLD = Object.freeze({
  DISCOVERY_MISSING: 'partition_discovery_missing_or_malformed',
  DISCOVERY_EMPTY: 'partition_discovery_empty',
  SHARD_MISSING: 'partition_shard_record_missing_or_malformed',
  NOT_EXECUTED: 'partition_discovered_file_not_executed',
  DUPLICATED: 'partition_file_executed_more_than_once',
  UNDISCOVERED: 'partition_executed_file_not_discovered',
});

const normalise = (root, file) => {
  if (typeof file !== 'string' || file.trim() === '') return null;
  const rel = path.isAbsolute(file) ? path.relative(root, file) : file;
  const unix = rel.split(path.sep).join('/').replace(/^\.\//, '');
  return unix.startsWith('../') ? null : unix;
};

/**
 * @param {{ root: string, discovered: unknown, shards: Array<{ shard: number, record: unknown }> }} input
 * @returns {{ ok: boolean, reasons: string[], discoveredCount: number, executedCount: number, perShard: Record<string, number> }}
 */
export function checkPartition({ root, discovered, shards }) {
  const reasons = [];
  const perShard = {};

  if (!Array.isArray(discovered)) {
    return { ok: false, reasons: [PARTITION_HOLD.DISCOVERY_MISSING], discoveredCount: 0, executedCount: 0, perShard };
  }
  const expected = new Set();
  for (const entry of discovered) {
    const file = normalise(root, entry?.file);
    if (!file) return { ok: false, reasons: [PARTITION_HOLD.DISCOVERY_MISSING], discoveredCount: 0, executedCount: 0, perShard };
    expected.add(file);
  }
  if (expected.size === 0) {
    return { ok: false, reasons: [PARTITION_HOLD.DISCOVERY_EMPTY], discoveredCount: 0, executedCount: 0, perShard };
  }

  const seen = new Map();
  for (const { shard, record } of shards) {
    const valid = record && typeof record === 'object' && record.schemaVersion === 1
      && record.kind === 'vitest-executed-files' && Array.isArray(record.files);
    if (!valid) {
      reasons.push(`${PARTITION_HOLD.SHARD_MISSING}:shard-${shard}`);
      continue;
    }
    perShard[`shard-${shard}`] = record.files.length;
    for (const entry of record.files) {
      const file = normalise(root, entry?.path);
      if (!file) {
        reasons.push(`${PARTITION_HOLD.SHARD_MISSING}:shard-${shard}`);
        break;
      }
      if (seen.has(file)) reasons.push(`${PARTITION_HOLD.DUPLICATED}:${file}:shard-${seen.get(file)}+shard-${shard}`);
      else seen.set(file, shard);
      if (!expected.has(file)) reasons.push(`${PARTITION_HOLD.UNDISCOVERED}:${file}`);
    }
  }
  for (const file of expected) {
    if (!seen.has(file)) reasons.push(`${PARTITION_HOLD.NOT_EXECUTED}:${file}`);
  }
  return { ok: reasons.length === 0, reasons, discoveredCount: expected.size, executedCount: seen.size, perShard };
}

// ---- CLI ---------------------------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''));
if (isMain) {
  const [, , discoveredPath, coverageDir = 'artifacts/coverage'] = process.argv;
  const shardCount = Number(process.env.UNIT_SHARDS || 4);
  const readJson = (file) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  };
  const shards = Array.from({ length: shardCount }, (_, i) => ({
    shard: i + 1,
    record: readJson(path.join(coverageDir, `shard-${i + 1}`, 'unit-file-timings.json')),
  }));
  const result = checkPartition({ root: process.cwd(), discovered: readJson(discoveredPath), shards });
  console.log(`[unit-partition] discovered=${result.discoveredCount} executed=${result.executedCount} ${JSON.stringify(result.perShard)}`);
  if (!result.ok) {
    for (const reason of result.reasons.slice(0, 50)) console.log(`::error::${reason}`);
    if (result.reasons.length > 50) console.log(`::error::...and ${result.reasons.length - 50} more`);
    process.exit(1);
  }
  console.log('[unit-partition] every discovered unit test file executed exactly once across shards');
}
