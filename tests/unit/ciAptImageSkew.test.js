import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

// Runner-image skew. `deps-prep` prefetches .debs on one runner image; each shard is scheduled
// independently and may draw a newer one. The `-dev` packages pin exact-equal runtime deps, so a bundle
// built on 20260823.283.1 cannot resolve on a shard running 20260831.293.1. Observed on run 33661182891
// (exit 100, "held broken packages", in Setup Environment before any test ran); a same-commit rerun moved
// the failing shard set, which is per-shard image assignment rather than code.
//
// These tests EXECUTE the scripts. The dispatcher is copied into a temp dir beside STUB siblings, so its
// own `dirname`-relative resolution picks up the stubs and the routing decision is observed directly —
// no test-only seam in the production script, and no substituting a source grep for the behaviour.
const root = process.cwd();
const SCRIPTS = resolve(root, 'scripts/ci');

// The distribution gate derives the shard's identity from /etc/os-release, `dpkg --print-architecture` and
// the lockfile. A test that does not supply all three is not exercising the compat path — it is being
// refused before reaching it. DIST_ENV + the dpkg stub give the shard a valid identity; the casualties
// below then vary ONE field to prove the refusal is real.
const LOCKED_PW = (readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8')
  .match(/playwright-core@(\d+\.\d+\.\d+)/) || [])[1];
const DIST_ENV = { ID: 'ubuntu', VERSION_CODENAME: 'noble' };

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apt-skew-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A bundle whose provenance says it was prefetched on `prepVersion`. */
function makeBundle({ prepVersion, manifest = 'canvas-sharp', pkgs = ['build-essential', 'libcairo2-dev'], dist = {}, offlineInputs = false } = {}) {
  const bundle = join(dir, 'apt-bundle');
  mkdirSync(join(bundle, 'debs'), { recursive: true });
  if (prepVersion !== null) {
    const d = { FAMILY: 'ubuntu', CODENAME: 'noble', ARCH: 'amd64', PLAYWRIGHT_VERSION: LOCKED_PW, ...dist };
    writeFileSync(join(bundle, 'image.manifest'),
      `FAMILY=${d.FAMILY}\nCODENAME=${d.CODENAME}\nARCH=${d.ARCH}\nPLAYWRIGHT_VERSION=${d.PLAYWRIGHT_VERSION}\nImageOS=ubuntu24\nImageVersion=${prepVersion}\n`);
  }
  if (pkgs !== null) writeFileSync(join(bundle, `${manifest}.manifest`), pkgs.join('\n') + '\n');
  // apt-install-offline.sh checks bundle presence at step 0, BEFORE the distribution gate at step 1, so a
  // test aiming at the gate must satisfy step 0 or it never gets there.
  if (offlineInputs) {
    writeFileSync(join(bundle, 'sha256sums.txt'), '');
    writeFileSync(join(bundle, 'debs', 'Packages'), '');
  }
  return bundle;
}

/** Copy the dispatcher next to stub children that only announce which path was taken. */
function stagedDispatcher() {
  const stage = join(dir, 'stage');
  mkdirSync(stage, { recursive: true });
  copyFileSync(join(SCRIPTS, 'apt-install.sh'), join(stage, 'apt-install.sh'));
  for (const child of ['apt-install-offline.sh', 'apt-install-compat.sh']) {
    const p = join(stage, child);
    writeFileSync(p, `#!/usr/bin/env bash\necho "TOOK:${child} args=$*"\nexit 0\n`);
    chmodSync(p, 0o755);
  }
  return join(stage, 'apt-install.sh');
}

function run(script, args, env = {}) {
  try {
    const stdout = execFileSync('bash', [script, ...args], {
      env: { PATH: process.env.PATH, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

describe('image-skew dispatcher: exactly one path, decided before anything installs', () => {
  it('MATCH routes to the offline bundle install', () => {
    const bundle = makeBundle({ prepVersion: '20260823.283.1' });
    const r = run(stagedDispatcher(), [bundle, 'canvas-sharp'], { ImageVersion: '20260823.283.1' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('TOOK:apt-install-offline.sh');
    expect(r.out).not.toContain('TOOK:apt-install-compat.sh');
  });

  // The defect this branch exists to fix: a skewed shard reaching the stale bundle.
  it('MISMATCH can NOT reach the offline bundle install', () => {
    const bundle = makeBundle({ prepVersion: '20260823.283.1' });
    const r = run(stagedDispatcher(), [bundle, 'canvas-sharp'], { ImageVersion: '20260831.293.1' });
    expect(r.code).toBe(0);
    expect(r.out, 'the stale bundle must never be attempted on a skewed shard').not.toContain('TOOK:apt-install-offline.sh');
    expect(r.out).toContain('TOOK:apt-install-compat.sh');
  });

  it('forwards the SAME bundle and manifest to whichever path it chose', () => {
    const bundle = makeBundle({ prepVersion: 'A', manifest: 'playwright' });
    const match = run(stagedDispatcher(), [bundle, 'playwright'], { ImageVersion: 'A' });
    const skew = run(stagedDispatcher(), [bundle, 'playwright'], { ImageVersion: 'B' });
    expect(match.out).toContain(`args=${bundle} playwright`);
    expect(skew.out).toContain(`args=${bundle} playwright`);
  });

  describe('missing or unknown provenance fails closed — an unknown image is not a match', () => {
    it('no image.manifest at all', () => {
      const bundle = makeBundle({ prepVersion: null });
      const r = run(stagedDispatcher(), [bundle, 'canvas-sharp'], { ImageVersion: '20260831.293.1' });
      expect(r.code).toBe(1);
      expect(r.out).toContain('missing provenance');
      expect(r.out).not.toContain('TOOK:');
    });
    it('prep ImageVersion literally "unknown"', () => {
      const bundle = makeBundle({ prepVersion: 'unknown' });
      const r = run(stagedDispatcher(), [bundle, 'canvas-sharp'], { ImageVersion: '20260831.293.1' });
      expect(r.code).toBe(1);
      expect(r.out).not.toContain('TOOK:');
    });
    it('shard ImageVersion unset', () => {
      const bundle = makeBundle({ prepVersion: '20260823.283.1' });
      const r = run(stagedDispatcher(), [bundle, 'canvas-sharp'], {});
      expect(r.code).toBe(1);
      expect(r.out).not.toContain('TOOK:');
    });
    // Two unknowns comparing equal would re-enter the offline path blind — the exact hole the gate closes.
    it('BOTH sides "unknown" must NOT compare equal into the offline path', () => {
      const bundle = makeBundle({ prepVersion: 'unknown' });
      const r = run(stagedDispatcher(), [bundle, 'canvas-sharp'], { ImageVersion: 'unknown' });
      expect(r.code).toBe(1);
      expect(r.out).not.toContain('TOOK:apt-install-offline.sh');
    });
    it('prep ImageVersion present but empty', () => {
      const bundle = makeBundle({ prepVersion: '' });
      const r = run(stagedDispatcher(), [bundle, 'canvas-sharp'], { ImageVersion: 'x' });
      expect(r.code).toBe(1);
      expect(r.out).not.toContain('TOOK:');
    });
  });
});

describe('compatibility path: bounded, single attempt, fail-closed, never the stale .debs', () => {
  /**
   * Stub `sudo`/`timeout`/`apt-get` on PATH.
   *
   * The shims must NEVER journal the command string they are wrapping: `sudo timeout -k 30 300 bash -c
   * "apt-get update && apt-get install ..."` embeds the text "apt-get install", so counting that text would
   * count the ECHOED COMMAND rather than an actual invocation — and would report a retry that never
   * happened. Only `apt-get` itself emits the INVOKE marker, and only when it really runs.
   */
  function stubbedPath({ updateExit = 0, installExit = 0 } = {}) {
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const journal = join(dir, 'journal.txt');
    writeFileSync(journal, '');
    writeFileSync(join(bin, 'sudo'), `#!/usr/bin/env bash\necho "SHIM sudo" >> ${journal}\nexec "$@"\n`);
    // GNU timeout signature: timeout -k <n> <secs> <cmd...> — record ONLY the bounding flags.
    writeFileSync(join(bin, 'timeout'), `#!/usr/bin/env bash\necho "SHIM timeout $1 $2 $3" >> ${journal}\nshift 3\nexec "$@"\n`);
    writeFileSync(join(bin, 'apt-get'), [
      '#!/usr/bin/env bash',
      `echo "INVOKE apt-get $*" >> ${journal}`,
      'sub="$1"; while [ "$#" -gt 0 ] && [ "${sub:0:1}" = "-" ]; do shift; sub="$1"; done',
      `case "$sub" in`,
      `  update) exit ${updateExit} ;;`,
      `  install) exit ${installExit} ;;`,
      '  *) exit 0 ;;',
      'esac',
    ].join('\n') + '\n');
    writeFileSync(join(bin, 'dpkg'), `#!/usr/bin/env bash\nif [ "$1" = "--print-architecture" ]; then echo amd64; exit 0; fi\necho "INVOKE dpkg $*" >> ${journal}\nexit 0\n`);
    for (const f of ['sudo', 'timeout', 'apt-get', 'dpkg']) chmodSync(join(bin, f), 0o755);
    const read = () => readFileSync(journal, 'utf8');
    return {
      bin, journal, read,
      /** Count REAL invocations only — never a line that merely quotes the command. */
      installs: () => (read().match(/^INVOKE apt-get .*\binstall\b/gm) || []).length,
    };
  }

  const compat = resolve(SCRIPTS, 'apt-install-compat.sh');

  it('installs the frozen manifest and never references the bundle .debs', () => {
    const bundle = makeBundle({ prepVersion: '20260823.283.1', pkgs: ['build-essential', 'libcairo2-dev'] });
    const s = stubbedPath();
    const r = run(compat, [bundle, 'canvas-sharp'], { PATH: `${s.bin}:${process.env.PATH}`, ...DIST_ENV });
    expect(r.code).toBe(0);
    const j = s.read();
    expect(j).toMatch(/^INVOKE apt-get .*install .*build-essential/m);
    expect(j).toMatch(/libcairo2-dev/);
    expect(j, 'the image-skewed .debs must never reach dpkg').not.toContain(`${bundle}/debs`);
    expect(j).not.toMatch(/dpkg -i/);
  });

  it('is bounded by a 300s deadline with a kill grace', () => {
    const bundle = makeBundle({ prepVersion: 'A' });
    const s = stubbedPath();
    run(compat, [bundle, 'canvas-sharp'], { PATH: `${s.bin}:${process.env.PATH}`, ...DIST_ENV });
    expect(s.read()).toMatch(/timeout -k 30 300/);
  });

  it('a timeout (124) fails the job, is reported DISTINCTLY, and is never retried or repaired', () => {
    const bundle = makeBundle({ prepVersion: 'A' });
    const s = stubbedPath({ installExit: 124 });
    const r = run(compat, [bundle, 'canvas-sharp'], { PATH: `${s.bin}:${process.env.PATH}`, ...DIST_ENV });
    expect(r.code).toBe(124);
    expect(r.out).toContain('TIMEOUT/CANCEL');
    expect(r.out).toContain('no retry/repair');
    const j = s.read();
    expect(s.installs(), 'exactly one install attempt — no retry after the kill').toBe(1);
    expect(j).not.toMatch(/dpkg --configure/);
  });

  it('a genuine apt failure propagates its own exit code and is not reported as a timeout', () => {
    const bundle = makeBundle({ prepVersion: 'A' });
    const s = stubbedPath({ installExit: 100 });
    const r = run(compat, [bundle, 'canvas-sharp'], { PATH: `${s.bin}:${process.env.PATH}`, ...DIST_ENV });
    expect(r.code).toBe(100);
    expect(r.out).toContain('genuine apt/dpkg exit');
    expect(r.out).not.toContain('TIMEOUT/CANCEL');
    expect(s.installs(), 'a genuine failure is not retried either').toBe(1);
  });

  it('fails closed on a missing or empty frozen manifest rather than installing nothing', () => {
    const s = stubbedPath();
    const noManifest = makeBundle({ prepVersion: 'A', pkgs: null });
    const r1 = run(compat, [noManifest, 'canvas-sharp'], { PATH: `${s.bin}:${process.env.PATH}`, ...DIST_ENV });
    expect(r1.code).toBe(1);
    expect(r1.out).toContain('missing frozen manifest');
    rmSync(join(dir, 'apt-bundle'), { recursive: true, force: true });
    const emptyManifest = makeBundle({ prepVersion: 'A', pkgs: [] });
    const r2 = run(compat, [emptyManifest, 'canvas-sharp'], { PATH: `${s.bin}:${process.env.PATH}`, ...DIST_ENV });
    expect(r2.code).toBe(1);
    expect(s.installs()).toBe(0);
  });

  // The manifest is a downloaded artifact whose contents become arguments to a privileged apt call. A
  // green suite once shipped a live shell-injection path in this repo, so this is a casualty, not a note.
  it.each([
    ['command substitution', 'build-essential\n$(touch /tmp/ss-pwned)'],
    ['chained command', 'build-essential; touch /tmp/ss-pwned'],
    ['backtick', 'build-essential`touch /tmp/ss-pwned`'],
    ['option injection', '--allow-downgrades'],
  ])('refuses a manifest containing %s and installs nothing', (_label, token) => {
    const bundle = makeBundle({ prepVersion: 'A', pkgs: [token] });
    const s = stubbedPath();
    const r = run(compat, [bundle, 'canvas-sharp'], { PATH: `${s.bin}:${process.env.PATH}`, ...DIST_ENV });
    expect(r.code).toBe(1);
    expect(r.out).toContain('not a valid package name');
    expect(s.installs(), 'a rejected manifest must not install a partial set').toBe(0);
    expect(existsSync('/tmp/ss-pwned'), 'no injected command may execute').toBe(false);
  });

  it('passes package names as arguments, never interpolated into a shell command string', () => {
    const text = readFileSync(compat, 'utf8');
    expect(text).toMatch(/"\$@"/);
    expect(text).not.toMatch(/bash -c "[^"]*\$PKGS/);
  });

  it('targets the standard Ubuntu archive, not the degraded Azure primary', () => {
    const text = readFileSync(compat, 'utf8');
    expect(text).toContain('http://archive.ubuntu.com/ubuntu');
    expect(text).toContain('azure');
    expect(text, 'the Azure primary is rewritten away, not targeted').toMatch(/s#https\?:\/\/azure/);
  });
});

describe('the dispatcher is what CI actually runs', () => {
  // A step name containing ": " makes the composite action's YAML unparseable, which GitHub rejects at
  // load time — the whole workflow, not just this step. It surfaced here first as a module-load crash in
  // the sibling contract suite; this states it directly so the next occurrence names itself.
  it('the composite action is valid YAML and the install step is a real, named step', () => {
    const doc = yaml.load(readFileSync(resolve(root, '.github/actions/setup-environment/action.yml'), 'utf8'));
    const names = doc.runs.steps.map((s) => s.name).filter(Boolean);
    expect(names).toContain('Install apt deps (image-gated: offline bundle, else bounded compatibility)');
  });
  it('setup-environment invokes apt-install.sh for bundle consumers', () => {
    const action = readFileSync(resolve(root, '.github/actions/setup-environment/action.yml'), 'utf8');
    expect(action).toContain('scripts/ci/apt-install.sh');
    expect(action).not.toMatch(/run: bash scripts\/ci\/apt-install-offline\.sh/);
  });
  it('both installation paths exist and are executable shell', () => {
    for (const f of ['apt-install.sh', 'apt-install-offline.sh', 'apt-install-compat.sh']) {
      expect(existsSync(join(SCRIPTS, f)), `${f} must exist`).toBe(true);
      execFileSync('bash', ['-n', join(SCRIPTS, f)]);
    }
  });
});

describe('distribution authority applies to BOTH paths (#1406 RETURN)', () => {
  const gate = resolve(SCRIPTS, 'apt-distribution-gate.sh');
  const compat = resolve(SCRIPTS, 'apt-install-compat.sh');

  /** Report a shard whose distribution identity we control, so a mismatch is observable. */
  function shardEnv({ arch = 'amd64' } = {}) {
    const bin = join(dir, 'dbin');
    mkdirSync(bin, { recursive: true });
    const journal = join(dir, 'dj.txt');
    writeFileSync(journal, '');
    writeFileSync(join(bin, 'dpkg'), `#!/usr/bin/env bash\nif [ "$1" = "--print-architecture" ]; then echo ${arch}; exit 0; fi\nexit 0\n`);
    writeFileSync(join(bin, 'sudo'), `#!/usr/bin/env bash\nexec "$@"\n`);
    writeFileSync(join(bin, 'timeout'), `#!/usr/bin/env bash\nshift 3\nexec "$@"\n`);
    writeFileSync(join(bin, 'apt-get'), `#!/usr/bin/env bash\necho "INVOKE apt-get $*" >> ${journal}\nexit 0\n`);
    for (const f of ['dpkg', 'sudo', 'timeout', 'apt-get']) chmodSync(join(bin, f), 0o755);
    return { bin, installs: () => (readFileSync(journal, 'utf8').match(/^INVOKE apt-get .*\binstall\b/gm) || []).length };
  }

  // The defect returned on #1406: the compatibility path ran apt with no distribution authority at all.
  it('the compatibility path REFUSES a foreign architecture and runs no apt', () => {
    const bundle = makeBundle({ prepVersion: 'A', dist: { ARCH: 'arm64' } });
    const s = shardEnv({ arch: 'amd64' });
    const r = run(compat, [bundle, 'canvas-sharp'], { PATH: `${s.bin}:${process.env.PATH}`, ...DIST_ENV });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/distribution mismatch on arch/);
    expect(s.installs(), 'no apt may run without distribution authority').toBe(0);
  });

  it.each(['FAMILY', 'CODENAME'])('the compatibility path REFUSES a foreign %s', (field) => {
    const bundle = makeBundle({ prepVersion: 'A', dist: { [field]: 'not-this-distro' } });
    const s = shardEnv();
    const r = run(compat, [bundle, 'canvas-sharp'], { PATH: `${s.bin}:${process.env.PATH}`, ...DIST_ENV });
    expect(r.code).toBe(1);
    expect(s.installs()).toBe(0);
  });

  it.each([['prep', { PLAYWRIGHT_VERSION: 'unknown' }], ['empty', { PLAYWRIGHT_VERSION: '' }]])(
    'missing/unknown authority (%s) fails closed rather than matching', (_l, dist) => {
      const bundle = makeBundle({ prepVersion: 'A', dist });
      const s = shardEnv();
      const r = run(compat, [bundle, 'canvas-sharp'], { PATH: `${s.bin}:${process.env.PATH}`, ...DIST_ENV });
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/authority missing\/unknown/);
      expect(s.installs()).toBe(0);
    });

  it('an UNREADABLE image.manifest fails closed with a named error and runs no apt', () => {
    const bundle = makeBundle({ prepVersion: 'A' });
    chmodSync(join(bundle, 'image.manifest'), 0o000);
    const s = shardEnv();
    const r = run(compat, [bundle, 'canvas-sharp'], { PATH: `${s.bin}:${process.env.PATH}`, ...DIST_ENV });
    chmodSync(join(bundle, 'image.manifest'), 0o644);
    expect(r.code).toBe(1);
    expect(r.out, 'the failure must NAME the cause, not die inside sed under set -e').toContain('unreadable');
    expect(s.installs()).toBe(0);
  });

  // Requirement 3, stated once for every authority failure mode rather than per-case.
  it.each([
    ['missing manifest', { drop: true, named: /missing .*image\.manifest/ }],
    ['foreign arch', { dist: { ARCH: 'arm64' }, named: /distribution mismatch on arch/ }],
    ['foreign codename', { dist: { CODENAME: 'jammy' }, named: /distribution mismatch on codename/ }],
    ['unknown playwright', { dist: { PLAYWRIGHT_VERSION: 'unknown' }, named: /playwright authority missing\/unknown/ }],
    ['empty family', { dist: { FAMILY: '' }, named: /family authority missing\/unknown/ }],
  ])('apt is NEVER invoked after an authority failure: %s', (_label, opts) => {
    const bundle = makeBundle({ prepVersion: 'A', dist: opts.dist || {} });
    if (opts.drop) rmSync(join(bundle, 'image.manifest'));
    const s = shardEnv();
    const r = run(compat, [bundle, 'canvas-sharp'], { PATH: `${s.bin}:${process.env.PATH}`, ...DIST_ENV });
    expect(r.code).toBe(1);
    // The error must NAME this cause. A generic `::error::` would let a manifest-presence check be deleted
    // and pass on the empty-field check's message instead.
    expect(r.out).toMatch(opts.named);
    expect(s.installs(), 'no apt command may follow a failed authority check').toBe(0);
  });

  // Executed, not grepped: the previous version asserted the script TEXT contained the gate's filename,
  // which the explanatory comment satisfied on its own — deleting the actual call still passed.
  it('the OFFLINE path also refuses a foreign architecture, before any checksum or apt work', () => {
    const bundle = makeBundle({ prepVersion: 'A', dist: { ARCH: 'arm64' }, offlineInputs: true });
    const s = shardEnv({ arch: 'amd64' });
    const r = run(resolve(SCRIPTS, 'apt-install-offline.sh'), [bundle, 'canvas-sharp'],
      { PATH: `${s.bin}:${process.env.PATH}`, ...DIST_ENV });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/distribution mismatch on arch/);
    expect(s.installs(), 'the offline path must not reach apt either').toBe(0);
  });

  it('the OFFLINE path proceeds past the gate when the distribution matches', () => {
    const bundle = makeBundle({ prepVersion: 'A', offlineInputs: true });
    const s = shardEnv();
    const r = run(resolve(SCRIPTS, 'apt-install-offline.sh'), [bundle, 'canvas-sharp'],
      { PATH: `${s.bin}:${process.env.PATH}`, ...DIST_ENV });
    expect(r.out, 'a matching distribution must clear the gate').toMatch(/distribution compatible/);
  });

  it('the gate is invoked by BOTH installation paths, before apt', () => {
    const compatText = readFileSync(compat, 'utf8');
    const offlineText = readFileSync(resolve(SCRIPTS, 'apt-install-offline.sh'), 'utf8');
    for (const [name, text] of [['compat', compatText], ['offline', offlineText]]) {
      expect(text, `${name} must call the shared gate`).toContain('apt-distribution-gate.sh');
      const gateAt = text.indexOf('apt-distribution-gate.sh');
      const aptAt = text.search(/^(sudo )?(apt-get|timeout|sudo apt-get)/m);
      expect(gateAt, `${name}: the gate must precede any apt invocation`).toBeLessThan(aptAt === -1 ? Infinity : aptAt);
    }
    expect(existsSync(gate)).toBe(true);
  });
});
