#!/usr/bin/env node
/**
 * Permanent SCA release gate (Gate 4) — OSV-based.
 *
 * Replaces the retired pnpm-audit legacy endpoint (registry.npmjs.org
 * /-/npm/v1/security/audits → HTTP 410). Enumerates advisories for the
 * committed pnpm-lock.yaml via osv-scanner (OSV.dev database) and FAILS on any
 * DISTINCT unignored CRITICAL advisory.
 *
 * Suppression policy is single-sourced from package.json →
 * pnpm.auditConfig.ignoreGhsas (retain only where explicitly justified in
 * product_release/SCA_EXCEPTIONS.md).
 *
 * Reproducible: osv-scanner is taken from $OSV_SCANNER or PATH; on linux/amd64
 * (CI) it is auto-downloaded at a pinned version + sha256 if absent.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir, platform, arch } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCKFILE = join(ROOT, 'pnpm-lock.yaml');
const OSV_VERSION = 'v1.9.2';
// Pinned sha256 by platform key. Add more as needed; unlisted platforms must
// provide osv-scanner on PATH.
const OSV_SHA256 = {
  'linux-x64': 'd6af4b67fa5de658598bd2d445efb99e90d1734b3146962418719c4350ecb74b',
};
const ASSET = { 'linux-x64': 'osv-scanner_linux_amd64', 'linux-arm64': 'osv-scanner_linux_arm64',
  'darwin-x64': 'osv-scanner_darwin_amd64', 'darwin-arm64': 'osv-scanner_darwin_arm64' };

function die(code, msg) { console.error(msg); process.exit(code); }

function readIgnoreList() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const list = pkg?.pnpm?.auditConfig?.ignoreGhsas ?? [];
  return new Set(list.map((s) => String(s).toUpperCase()));
}

async function resolveScanner() {
  if (process.env.OSV_SCANNER && existsSync(process.env.OSV_SCANNER)) return process.env.OSV_SCANNER;
  // on PATH?
  try { execFileSync('osv-scanner', ['--version'], { stdio: 'ignore' }); return 'osv-scanner'; } catch { /* not on PATH */ }
  const key = `${platform()}-${arch()}`;
  const sha = OSV_SHA256[key];
  if (!sha) die(2, `[sca] osv-scanner not found on PATH and no pinned binary for ${key}.\n` +
    `      Install it (e.g. "brew install osv-scanner") or set $OSV_SCANNER.`);
  const cacheDir = join(ROOT, 'node_modules', '.cache', 'osv');
  mkdirSync(cacheDir, { recursive: true });
  const bin = join(cacheDir, `osv-scanner-${OSV_VERSION}`);
  if (!existsSync(bin) || createHash('sha256').update(readFileSync(bin)).digest('hex') !== sha) {
    const url = `https://github.com/google/osv-scanner/releases/download/${OSV_VERSION}/${ASSET[key]}`;
    console.error(`[sca] downloading pinned osv-scanner ${OSV_VERSION} (${key})…`);
    const res = await fetch(url); const buf = Buffer.from(await res.arrayBuffer());
    const got = createHash('sha256').update(buf).digest('hex');
    if (got !== sha) die(2, `[sca] osv-scanner checksum mismatch: expected ${sha} got ${got}`);
    writeFileSync(bin, buf); chmodSync(bin, 0o755);
  }
  return bin;
}

function severityOf(v) {
  const ds = (v.database_specific?.severity || '').toUpperCase();
  if (ds) return ds;
  // fallback: CVSS v3 base score → rating
  const cvss = (v.severity || []).find((s) => /CVSS/.test(s.type));
  const m = cvss?.score && /\/([0-9.]+)\b/.exec(cvss.score);
  const score = m ? parseFloat(m[1]) : (cvss?.score ? parseFloat(cvss.score) : NaN);
  if (!Number.isNaN(score)) return score >= 9 ? 'CRITICAL' : score >= 7 ? 'HIGH' : score >= 4 ? 'MODERATE' : 'LOW';
  return 'UNKNOWN';
}

const scanner = await resolveScanner();
if (!existsSync(LOCKFILE)) die(2, `[sca] lockfile not found: ${LOCKFILE}`);

let out = '';
try {
  out = execFileSync(scanner, ['--lockfile', LOCKFILE, '--format', 'json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  // osv-scanner exits non-zero WHEN vulnerabilities are found; JSON is still on stdout.
  out = e.stdout?.toString() || '';
  if (!out) die(2, `[sca] osv-scanner failed with no output: ${e.message}`);
}

let data; try { data = JSON.parse(out); } catch (e) { die(2, `[sca] cannot parse osv JSON: ${e.message}`); }

const ignore = readIgnoreList();
const bySeverity = { CRITICAL: 0, HIGH: 0, MODERATE: 0, LOW: 0, UNKNOWN: 0 };
const criticals = new Map(); // distinct advisory id -> {ids, pkg, ver, ignored, summary}
for (const r of data.results || []) {
  for (const p of r.packages || []) {
    for (const v of p.vulnerabilities || []) {
      const sev = severityOf(v);
      bySeverity[sev] = (bySeverity[sev] || 0) + 1;
      if (sev !== 'CRITICAL') continue;
      const ids = [v.id, ...(v.aliases || [])].filter(Boolean);
      const key = ids.find((i) => /^GHSA-/i.test(i)) || v.id;
      const ignored = ids.some((i) => ignore.has(String(i).toUpperCase()));
      criticals.set(key, { ids, pkg: p.package?.name, ver: p.package?.version, ignored, summary: (v.summary || '').slice(0, 100) });
    }
  }
}

const distinct = [...criticals.values()];
const unignored = distinct.filter((c) => !c.ignored);

console.log('=== SCA Gate 4 (OSV) ===');
console.log(`osv-scanner ${OSV_VERSION} · lockfile pnpm-lock.yaml`);
console.log(`severity histogram: ${JSON.stringify(bySeverity)}`);
console.log(`distinct CRITICAL advisories: ${distinct.length} (ignored: ${distinct.length - unignored.length})`);
for (const c of distinct) {
  console.log(`  ${c.ignored ? 'IGNORED ' : 'BLOCKING'} ${c.ids.join(',')}  ${c.pkg}@${c.ver}  ${c.summary}`);
}
if (ignore.size) console.log(`ignore policy (package.json pnpm.auditConfig.ignoreGhsas): ${[...ignore].join(', ')}`);

if (unignored.length > 0) {
  console.error(`\n[sca] FAIL — ${unignored.length} distinct unignored CRITICAL advisory(ies).`);
  process.exit(1);
}
console.log('\n[sca] PASS — zero distinct unignored CRITICAL advisories.');
process.exit(0);
