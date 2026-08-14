import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';

// #1294 fail-closed guard: SpeakSharp has no Basic product and the ambiguous CANARY_PASSWORD secret is
// retired. This prevents any of the retired credential/secret/tier/input names — or a Stripe Basic price —
// from returning to ACTIVE source, workflows, config, tests, or current documentation. Immutable pinned
// archive/evidence provenance is intentionally excluded; nothing active may depend on it.
const ROOT = resolve(process.cwd());

// Directories that hold immutable provenance or generated output — never active authority.
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'playwright-report', 'test-results']);
const EXCLUDED_PATHS = [
  'product_release/archive/',
  'product_release/evidence/',
  // The temporary implementation packet is removed before review (tracked separately); do not scan it.
  '.github/runbooks/rc-test-account-canary-closeout.md',
  // This guard file necessarily names the forbidden tokens.
  'tests/deps/no-legacy-basic-canary-tokens.test.js',
];
const SCANNED_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.yml', '.yaml', '.md', '.json', '.example', '.sh', '.toml']);
const SCANNED_ROOTS = ['.github', 'scripts', 'tests', 'frontend/src', 'frontend/tests', 'backend', 'product_release', '.agent'];
const ROOT_FILES = ['.env.test.example', 'AGENTS.md', 'playwright.canary.config.ts', 'playwright.config.ts', 'package.json'];

const FORBIDDEN = [
  { label: 'retired ambiguous CANARY_PASSWORD (use lane-specific CANARY_TRIAL_PASSWORD / CANARY_PAID_PASSWORD, or the lane-resolved CANARY_LANE_PASSWORD)', re: /\bCANARY_PASSWORD\b/ },
  { label: 'retired BASIC_TEST_EMAIL account credential', re: /\bBASIC_TEST_EMAIL\b/ },
  { label: 'retired BASIC_TEST_PASSWORD account credential', re: /\bBASIC_TEST_PASSWORD\b/ },
  { label: 'retired E2E_BASIC_EMAIL account credential', re: /\bE2E_BASIC_EMAIL\b/ },
  { label: 'retired E2E_BASIC_PASSWORD account credential', re: /\bE2E_BASIC_PASSWORD\b/ },
  { label: 'retired STRIPE_BASIC_PRICE_ID (SpeakSharp has no Basic product)', re: /\bSTRIPE_BASIC_PRICE_ID\b/ },
  { label: 'retired STRIPE_LIVE_BASIC_PRICE_ID (SpeakSharp has no Basic product)', re: /\bSTRIPE_LIVE_BASIC_PRICE_ID\b/ },
  { label: 'retired Basic count/input/tier alias', re: /\b(NEW_BASIC_COUNT|NUM_BASIC_USERS|BASIC_USER_COUNT|TEST_USER_BASIC|new_basic_count)\b/ },
  { label: 'any secrets.*BASIC* GitHub secret reference', re: /secrets\.[A-Za-z0-9_]*BASIC[A-Za-z0-9_]*/i },
];

function isExcluded(relPath) {
  return EXCLUDED_PATHS.some((p) => relPath === p || relPath.startsWith(p));
}

function* walk(absDir, relDir) {
  for (const name of readdirSync(absDir)) {
    const abs = join(absDir, name);
    const rel = relDir ? `${relDir}/${name}` : name;
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (EXCLUDED_DIRS.has(name) || isExcluded(`${rel}/`)) continue;
      yield* walk(abs, rel);
    } else if (st.isFile() && SCANNED_EXT.has(extname(name)) && !isExcluded(rel)) {
      yield { abs, rel };
    }
  }
}

function collectFiles() {
  const files = [];
  for (const r of SCANNED_ROOTS) {
    let st;
    try { st = statSync(join(ROOT, r)); } catch { continue; }
    if (st.isDirectory()) files.push(...walk(join(ROOT, r), r));
  }
  for (const f of ROOT_FILES) {
    try { if (statSync(join(ROOT, f)).isFile()) files.push({ abs: join(ROOT, f), rel: f }); } catch { /* absent */ }
  }
  return files;
}

describe('#1294 — no retired Basic / CANARY_PASSWORD tokens in active source', () => {
  const files = collectFiles();

  it('scans a non-trivial set of active files (guard is not silently empty)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(FORBIDDEN)('has zero active references to $label', ({ re }) => {
    const hits = [];
    for (const { abs, rel } of files) {
      const text = readFileSync(abs, 'utf8');
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => { if (re.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`); });
    }
    expect(hits, `retired token found in active source:\n${hits.join('\n')}`).toEqual([]);
  });
});
