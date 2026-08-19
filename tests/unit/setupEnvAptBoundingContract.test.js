import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

// #1311 contract. TWO layers are frozen here:
//  (A) the bounded, FAIL-CLOSED network apt steps (used only as the fallback when apt-bundle != 'true'), and
//  (B) the prefetch experiment: download the COMPLETE apt bundle ONCE (retry only the safe download-only
//      phase), then install on every shard OFFLINE with mirror downloads disabled, at restored 4-wide.
// This test makes a future edit unable to silently reintroduce an unbounded apt phase, an apt retry-after-
// kill, a shard mirror call, a broad cache restore-key, or a non-fail-closed bundle install.
const root = process.cwd();
const readText = (p) => readFileSync(resolve(root, p), 'utf8');
const actionText = readText('.github/actions/setup-environment/action.yml');
const actionDoc = yaml.load(actionText);
const steps = actionDoc.runs.steps;
const stepByName = (name) => steps.find((s) => s.name === name);
const ci = yaml.load(readText('.github/workflows/ci.yml'));
const prefetch = readText('scripts/ci/apt-prefetch.sh');
const offline = readText('scripts/ci/apt-install-offline.sh');

// ── (A) retained bounded, fail-closed NETWORK apt fallback ───────────────────────────────────────────────
const APT_STEPS = [
  'Install System Dependencies (Canvas/Sharp)',
  'Install Playwright system deps (apt)',
];
describe.each(APT_STEPS)(
  'network apt fallback "%s": bounded, fail-closed, bundle-gated (#1311)',
  (name) => {
    const step = stepByName(name);
    it('is Linux-gated and SKIPS when the prefetch bundle is used (apt-bundle == true)', () => {
      expect(step).toBeTruthy();
      expect(step.if).toContain("runner.os == 'Linux'");
      expect(step.if).toContain("inputs.apt-bundle != 'true'");
    });
    it('wraps apt in a bounded `timeout`, fail-closed, distinct 124/137, no retry loop, no dpkg repair', () => {
      expect(step.run).toMatch(/timeout(\s+-k\s+\d+)?\s+\d+\b/);
      expect(step.run).toMatch(/exit\s+\$rc/);
      expect(step.run).toMatch(/124/);
      expect(step.run).toMatch(/137/);
      expect(step.run).not.toMatch(/\buntil\b|\bfor\s+i\b|&&\s*break/);
      expect(step.run).not.toMatch(/dpkg\s+--configure/);
    });
  },
);

// ── (B) prefetch experiment ──────────────────────────────────────────────────────────────────────────────
describe('prefetch: deps-prep job downloads the bundle once (#1311)', () => {
  const job = ci.jobs['deps-prep'];
  it('exists and both shard families depend on it', () => {
    expect(job).toBeTruthy();
    expect(ci.jobs['unit-shard'].needs).toContain('deps-prep');
    expect(ci.jobs['e2e'].needs).toContain('deps-prep');
  });
  it('cache key is EXACT with NO broad restore-key', () => {
    const cacheStep = job.steps.find(
      (s) => s.id === 'apt-bundle-cache' || (s.uses || '').includes('actions/cache'),
    );
    expect(cacheStep).toBeTruthy();
    expect(cacheStep.with.key).toMatch(/noble/); // Ubuntu release pinned into the key
    expect(cacheStep.with.key).toContain('runner.arch');
    expect(cacheStep.with['restore-keys']).toBeUndefined();
  });
  it('uploads the bundle fail-closed (error if empty)', () => {
    const up = job.steps.find((s) => (s.uses || '').includes('upload-artifact'));
    expect(up.with['if-no-files-found']).toBe('error');
  });
});

describe('prefetch script: retry ONLY around --download-only; never dpkg install (#1311)', () => {
  it('pins to the standard Ubuntu archive (intended rewrite target, not sed escape representation)', () => {
    // Assert the INTENDED outcome — the prep rewrites the source to the standard archive — rather than
    // coupling to how sed happens to escape the azure source token.
    expect(prefetch).toMatch(/https?:\/\/archive\.ubuntu\.com\/ubuntu/);
  });
  it('derives the Playwright manifest from install-deps --dry-run (not a stale hard-coded list)', () => {
    expect(prefetch).toContain('playwright install-deps chromium --dry-run');
  });
  it('uses --download-only, bounds each attempt with timeout, and the ONLY retry is the download-only phase', () => {
    expect(prefetch).toContain('--download-only');
    expect(prefetch).toMatch(/timeout -k 30 300/);
    // the retry helper wraps download-only exclusively
    expect(prefetch).toMatch(/download_only\(\)\s*\{[^}]*--download-only/);
  });
  it('every REAL prep-phase apt-get install is download-only; no dpkg install/configure', () => {
    // Inspect actual executable command lines — exclude manifest-parser text (grep/sed over --dry-run
    // output that merely quotes the string "apt-get install"). A real invocation runs the command;
    // parser lines pipe/rewrite a captured string.
    const realAptInstall = prefetch
      .split('\n')
      .filter((l) => !/^\s*#/.test(l)) // drop comment lines
      .filter((l) => /(^|[;&|]|\bsudo\b|\btimeout\b)[^'"]*\bapt-get install\b/.test(l))
      .filter((l) => !/\bgrep\b|\bsed\b/.test(l)); // drop manifest-parser lines
    expect(realAptInstall.length).toBeGreaterThan(0);
    for (const line of realAptInstall) expect(line).toContain('--download-only');
    // and no dpkg install/configure transaction in prep
    expect(prefetch).not.toMatch(/dpkg\s+-i\b|dpkg\s+--configure/);
  });
  it('builds a local flat apt repository index (dpkg-scanpackages -> Packages) and an image manifest', () => {
    expect(prefetch).toContain('dpkg-scanpackages');
    expect(prefetch).toContain('Packages');
    expect(prefetch).toContain('image.manifest');
    expect(prefetch).toMatch(/ImageOS|ImageVersion/);
  });
  it('reports index shape as DIAGNOSTIC only — no representation-level blockers (classification/preinstalled/stanza/Filename gates)', () => {
    expect(prefetch).toMatch(/diagnostic/);
    expect(prefetch).not.toContain('preinstalled.manifest');
    expect(prefetch).not.toMatch(/neither bundled nor image-satisfied/);
    expect(prefetch).not.toMatch(/does not resolve under repo root/);
  });
});

describe('local-repository install: file:-only, image/checksum gated, no retry/repair (#1311)', () => {
  it('resolves via apt against a LOCAL flat file: repository (not raw --no-download file install)', () => {
    expect(offline).toMatch(/deb \[trusted=yes\] file:\/\//);
    expect(offline).toContain('Dir::Etc::sourcelist');
    expect(offline).toContain('Dir::Etc::sourceparts');
    expect(offline).toContain('apt-get');
  });
  it('isolates ALL apt paths absolutely: sourcelist/sourceparts/lists are dedicated (no relative path, no runner /var/lib/apt/lists)', () => {
    // absolute base (no relative path passed to Dir::Etc::sourcelist -> apt would resolve it against /etc/apt)
    expect(offline).toMatch(/BUNDLE_ABS="\$\(cd "\$BUNDLE" && pwd\)"/);
    expect(offline).toContain('Dir::State::lists');           // dedicated lists dir isolation
    expect(offline).not.toMatch(/Dir::Etc::sourceparts=\/dev\/null/); // must be a dedicated dir, not /dev/null
    expect(offline).toMatch(/mkdir -p "\$SRCPARTS" "\$LISTS/); // dedicated empty dirs (+ partial child)
  });
  it('SOLE functional proof: apt --simulate resolves the complete manifest, then real install under the SAME opts — no proxy scaffolding', () => {
    expect(offline).toMatch(/--simulate .*install \$PKGS/);   // simulate the complete frozen manifest
    expect(offline).toMatch(/-y install \$PKGS/);             // real install (same isolated opts)
    // the stripped representation-level guards must be GONE:
    expect(offline).not.toContain('preinstalled.manifest');
    expect(offline).not.toContain('apt-cache');
    expect(offline).not.toMatch(/did not load|non-empty index/);
    expect(offline).not.toContain('dpkg-query');
  });
  it('enforces network isolation: fails on any http/https or Azure/archive mirror in source or apt output', () => {
    expect(offline).toContain('https?://');
    expect(offline).toContain('archive.ubuntu.com');
    expect(offline).toContain('NETWORK ISOLATION VIOLATED');
    // must NOT use Debug::NoLocking as a network-isolation proof
    expect(offline).not.toContain('Debug::NoLocking');
  });
  it('gates on DISTRIBUTION (family/codename/arch/playwright), treats ImageVersion as provenance-only, uses --no-remove, fails closed', () => {
    expect(offline).toMatch(/distribution mismatch/i);       // loosened gate replaces exact-ImageVersion equality
    expect(offline).toContain('NOT gated');                  // ImageVersion is provenance only, not a blocking check
    expect(offline).not.toContain('image mismatch');         // the exact-image-build proxy gate is gone
    expect(offline).toContain('sha256sum -c');               // checksum integrity retained
    // apt-native --no-remove on BOTH the simulation and the real install (no removals/downgrades to force a fit)
    expect((offline.match(/--no-remove/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(offline).toMatch(/::error::/);
    expect(offline).toMatch(/exit 1/);
  });
  it('never calls playwright install-deps, never retries, never repairs dpkg, never wraps install in timeout', () => {
    expect(offline).not.toContain('playwright install-deps');
    expect(offline).not.toMatch(/\buntil\b|\bfor\s+i\b|&&\s*break/);
    expect(offline).not.toMatch(/dpkg\s+--configure/);
    expect(offline).not.toMatch(/timeout\s+-k/);
  });
});

describe('shards consume the bundle offline (#1311)', () => {
  it('the action skips the network apt steps and runs the offline install under apt-bundle', () => {
    expect(stepByName('Install apt deps from bundle (offline, no mirror)')).toBeTruthy();
    expect(actionText).toContain('scripts/ci/apt-install-offline.sh');
  });
  it('unit shards request the canvas-sharp bundle; e2e shards request the playwright bundle', () => {
    const unitSetup = ci.jobs['unit-shard'].steps.find((s) => s.name === 'Setup Environment');
    const e2eSetup = ci.jobs['e2e'].steps.find((s) => s.name === 'Setup Environment');
    expect(unitSetup.with['apt-bundle']).toBe('true');
    expect(unitSetup.with['apt-bundle-manifest']).toBe('canvas-sharp');
    expect(e2eSetup.with['apt-bundle']).toBe('true');
    expect(e2eSetup.with['apt-bundle-manifest']).toBe('playwright');
  });
});

describe.each(['unit-shard', 'e2e'])(
  'ci.yml "%s": 4-wide default concurrency + job backstop retained (#1311)',
  (job) => {
    it('has NO max-parallel throttle (restored 4-wide/default)', () => {
      expect(ci.jobs[job].strategy['max-parallel']).toBeUndefined();
    });
    it('keeps a job-level timeout-minutes backstop', () => {
      expect(typeof ci.jobs[job]['timeout-minutes']).toBe('number');
    });
  },
);
