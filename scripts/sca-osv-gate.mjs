#!/usr/bin/env node
/**
 * Permanent SCA release gate (Gate 4) — OSV-based. Replaces the retired
 * pnpm-audit legacy endpoint (HTTP 410). FAILS CLOSED on any distinct unignored
 * CRITICAL (or unclassifiable UNKNOWN) advisory in ANY scanned lockfile, and on
 * any scanner/parse error. Scans BOTH the root pnpm-lock.yaml AND the committed
 * DB-harness tests/db/package-lock.json so those pinned deps are SCA-covered.
 * Decision logic + CVSS parsing live in ./lib and are unit-tested.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { platform, arch } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOsvJson, evaluateOsv, ignoreSetFromPkg, scannerStdoutOrThrow } from './lib/sca-gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Every locked dependency graph in the repo that CI installs. Both must be SCA-covered.
const LOCKFILES = [
  join(ROOT, 'pnpm-lock.yaml'),
  join(ROOT, 'tests', 'db', 'package-lock.json'),
];
const OSV_VERSION = 'v1.9.2';
const OSV_SHA256 = { 'linux-x64': 'd6af4b67fa5de658598bd2d445efb99e90d1734b3146962418719c4350ecb74b' };
const ASSET = { 'linux-x64': 'osv-scanner_linux_amd64', 'linux-arm64': 'osv-scanner_linux_arm64',
  'darwin-x64': 'osv-scanner_darwin_amd64', 'darwin-arm64': 'osv-scanner_darwin_arm64' };

function die(code, msg) { console.error(msg); process.exit(code); }

async function resolveScanner() {
  if (process.env.OSV_SCANNER && existsSync(process.env.OSV_SCANNER)) return process.env.OSV_SCANNER;
  try { execFileSync('osv-scanner', ['--version'], { stdio: 'ignore' }); return 'osv-scanner'; } catch { /* not on PATH */ }
  const key = `${platform()}-${arch()}`;
  const sha = OSV_SHA256[key];
  if (!sha) die(2, `[sca] osv-scanner not found and no pinned binary for ${key}. Install it ("brew install osv-scanner") or set $OSV_SCANNER.`);
  const cacheDir = join(ROOT, 'node_modules', '.cache', 'osv');
  mkdirSync(cacheDir, { recursive: true });
  const bin = join(cacheDir, `osv-scanner-${OSV_VERSION}`);
  if (!existsSync(bin) || createHash('sha256').update(readFileSync(bin)).digest('hex') !== sha) {
    const url = `https://github.com/google/osv-scanner/releases/download/${OSV_VERSION}/${ASSET[key]}`;
    console.error(`[sca] downloading pinned osv-scanner ${OSV_VERSION} (${key})…`);
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const got = createHash('sha256').update(buf).digest('hex');
    if (got !== sha) die(2, `[sca] osv-scanner checksum mismatch: expected ${sha} got ${got}`);
    writeFileSync(bin, buf); chmodSync(bin, 0o755);
  }
  return bin;
}

// Scan ONE lockfile and evaluate it. Fails CLOSED (die 2) on any scanner/parse error.
export function scanOne(scanner, lockfile, ignore, relLabel) {
  // Normalise the execFileSync outcome to {status, signal, stdout}: on success execFileSync returns
  // stdout (exit 0); on nonzero exit it throws with e.status/e.signal/e.stdout. scannerStdoutOrThrow
  // fails CLOSED on anything but exit 0/1.
  let result;
  try {
    const stdout = execFileSync(scanner, ['--lockfile', lockfile, '--format', 'json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    result = { status: 0, signal: null, stdout };
  } catch (e) {
    result = { status: e.status ?? null, signal: e.signal ?? null, stdout: e.stdout };
  }
  let out;
  try { out = scannerStdoutOrThrow(result); } catch (e) { die(2, `[sca] ${relLabel}: ${e.message}`); }
  let data;
  try { data = parseOsvJson(out); } catch (e) { die(2, `[sca] ${relLabel}: ${e.message}`); }
  return evaluateOsv(data, ignore);
}

async function main() {
  for (const lf of LOCKFILES) if (!existsSync(lf)) die(2, `[sca] lockfile not found: ${lf}`);
  const scanner = await resolveScanner();
  const ignore = ignoreSetFromPkg(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')));

  console.log('=== SCA Gate 4 (OSV) ===');
  if (ignore.size) console.log(`ignore policy (package.json pnpm.auditConfig.ignoreGhsas): ${[...ignore].join(', ')}`);
  let totalBlocking = 0;
  for (const lf of LOCKFILES) {
    const rel = lf.slice(ROOT.length + 1);
    const { histogram, distinct, blocking, pass } = scanOne(scanner, lf, ignore, rel);
    console.log(`\n--- ${rel} (osv-scanner ${OSV_VERSION}) ---`);
    console.log(`severity histogram: ${JSON.stringify(histogram)}`);
    console.log(`gate-relevant advisories (critical/unknown): ${distinct.length} (ignored: ${distinct.length - blocking.length})`);
    for (const c of distinct) {
      console.log(`  ${c.ignored ? 'IGNORED ' : 'BLOCKING'} [${c.severity}] ${c.ids.join(',')}  ${c.pkg}@${c.ver}  (${c.paths} path${c.paths > 1 ? 's' : ''})  ${c.summary}`);
    }
    console.log(`  ${rel}: ${pass ? 'PASS' : `FAIL (${blocking.length} blocking)`}`);
    totalBlocking += blocking.length;
  }
  if (totalBlocking > 0) die(1, `\n[sca] FAIL — ${totalBlocking} distinct unignored critical/unknown advisory(ies) across ${LOCKFILES.length} lockfile(s).`);
  console.log(`\n[sca] PASS — zero distinct unignored critical/unknown advisories across ${LOCKFILES.length} lockfile(s).`);
}

// Run only when executed directly (so `scanOne` can be imported by tests without side effects).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => die(2, `[sca] unexpected error: ${e?.stack || e}`));
}
