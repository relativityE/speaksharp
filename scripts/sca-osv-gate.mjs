#!/usr/bin/env node
/**
 * Permanent SCA release gate (Gate 4) — OSV-based. Replaces the retired
 * pnpm-audit legacy endpoint (HTTP 410). FAILS on any distinct unignored
 * CRITICAL (or unclassifiable UNKNOWN) advisory in pnpm-lock.yaml.
 * Decision logic + CVSS parsing live in ./lib and are unit-tested.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { platform, arch } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOsvJson, evaluateOsv, ignoreSetFromPkg } from './lib/sca-gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCKFILE = join(ROOT, 'pnpm-lock.yaml');
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

async function main() {
  if (!existsSync(LOCKFILE)) die(2, `[sca] lockfile not found: ${LOCKFILE}`);
  const scanner = await resolveScanner();
  let out = '';
  try {
    out = execFileSync(scanner, ['--lockfile', LOCKFILE, '--format', 'json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    // osv-scanner exits non-zero when it FINDS vulnerabilities; JSON is still on stdout.
    out = e.stdout?.toString() || '';
    if (!out) die(2, `[sca] osv-scanner failed with no output: ${e.message}`);
  }
  let data;
  try { data = parseOsvJson(out); } catch (e) { die(2, `[sca] ${e.message}`); }
  const ignore = ignoreSetFromPkg(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')));
  const { histogram, distinct, blocking, pass } = evaluateOsv(data, ignore);

  console.log('=== SCA Gate 4 (OSV) ===');
  console.log(`osv-scanner ${OSV_VERSION} · lockfile pnpm-lock.yaml`);
  console.log(`severity histogram: ${JSON.stringify(histogram)}`);
  console.log(`gate-relevant advisories (critical/unknown): ${distinct.length} (ignored: ${distinct.length - blocking.length})`);
  for (const c of distinct) {
    console.log(`  ${c.ignored ? 'IGNORED ' : 'BLOCKING'} [${c.severity}] ${c.ids.join(',')}  ${c.pkg}@${c.ver}  (${c.paths} path${c.paths > 1 ? 's' : ''})  ${c.summary}`);
  }
  if (ignore.size) console.log(`ignore policy (package.json pnpm.auditConfig.ignoreGhsas): ${[...ignore].join(', ')}`);
  if (!pass) die(1, `\n[sca] FAIL — ${blocking.length} distinct unignored critical/unknown advisory(ies).`);
  console.log('\n[sca] PASS — zero distinct unignored critical/unknown advisories.');
}

main().catch((e) => die(2, `[sca] unexpected error: ${e?.stack || e}`));
