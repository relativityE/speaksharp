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
  // These meta-artifacts necessarily NAME the retired tokens — the guard tests (to assert absence) and the
  // attack-surface audit (to schedule the post-merge deletion of those exact Secret names).
  'tests/deps/no-legacy-basic-canary-tokens.test.js',
  'tests/unit/adminTestUsersWorkflowContract.test.js',
  // #1294: this guard asserts the workflow does NOT contain the retired token — it must name it to do so.
  'tests/release/flawless-launch-product-contract-guard.test.ts',
  'product_release/SECRETS_ATTACK_SURFACE_AUDIT.md',
];
const SCANNED_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.yml', '.yaml', '.md', '.json', '.example', '.sh', '.toml']);
const SCANNED_ROOTS = ['.github', 'scripts', 'tests', 'frontend/src', 'frontend/tests', 'backend', 'product_release', '.agent'];
const ROOT_FILES = ['.env.test.example', 'AGENTS.md', 'playwright.canary.config.ts', 'playwright.config.ts', 'package.json'];

// Retired Basic credential/price/input/Secret/Variable identifiers (SpeakSharp has no Basic product) + the
// account-admin `- basic` tier option + `basic-user` reusable account, plus the ambiguous CANARY_PASSWORD.
// These are intentionally PRECISE: they never match unrelated tokens such as the filler word "basically",
// HTTP "Basic" auth, or the legacy `subscription_status: 'basic'` DB value (a separate, still-functional
// backward-compat tier that maps to Free — out of this cleanup's scope).
export const FORBIDDEN = [
  { label: 'retired ambiguous CANARY_PASSWORD (use CANARY_TRIAL_PASSWORD / CANARY_PAID_PASSWORD / CANARY_LANE_PASSWORD)', re: /\bCANARY_PASSWORD\b/ },
  { label: 'retired Basic credential/price/input identifier', re: /\b(?:BASIC_TEST_EMAIL|BASIC_TEST_PASSWORD|E2E_BASIC_EMAIL|E2E_BASIC_PASSWORD|STRIPE_BASIC_PRICE_ID|STRIPE_LIVE_BASIC_PRICE_ID|NEW_BASIC_COUNT|NUM_BASIC_USERS|BASIC_USER_COUNT|TEST_USER_BASIC)\b/ },
  { label: 'any secrets.*BASIC* / vars.*BASIC* Secret or Variable reference (case-insensitive)', re: /(?:secrets|vars)\.[A-Za-z0-9_]*BASIC[A-Za-z0-9_]*/i },
  { label: 'basic tier as a workflow-dispatch choice option (a `- basic` list item)', re: /^\s*-\s*basic\s*$/i },
  { label: 'basic-named reusable test account (basic-user / basic_user)', re: /\bbasic[-_]user\b/i },
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

// POSITIVE fixture: prove the guard actually CATCHES retired Basic identifiers (incl. vars.*BASIC* and
// lower-case tier/account aliases) and does NOT flag unrelated English words such as "basically".
describe('#1294 guard positive fixture — catches Basic identifiers, ignores prose', () => {
  const anyMatch = (s) => FORBIDDEN.some(({ re }) => re.test(s));

  it.each([
    "CANARY_PASSWORD: ${{ secrets.CANARY_PASSWORD }}",
    'BASIC_TEST_EMAIL',
    'E2E_BASIC_PASSWORD',
    'STRIPE_LIVE_BASIC_PRICE_ID',
    'NEW_BASIC_COUNT',
    'TEST_USER_BASIC',
    'vars.STRIPE_BASIC_PRICE_ID',
    'vars.SomethingBasicThing',      // any *BASIC* Secret/Variable ref, case-insensitive
    'secrets.BASIC_TEST_EMAIL',
    '  - basic',                     // the retired create_tier choice option
    'basic-user@test.com',
    'const x = "basic_user";',
  ])('CATCHES %s', (s) => { expect(anyMatch(s)).toBe(true); });

  it.each([
    'This is basically a comment.',                       // filler word — never flagged
    'const KEY = "BASICALLY";',                            // filler-word key
    "subscription_status: 'free' | 'basic' | 'pro'",      // legacy DB tier value (separate, functional)
    "expect(isPro('basic')).toBe(false);",                // legacy tier test
    "res.headers.get('WWW-Authenticate') // Basic",       // HTTP Basic auth
    'a fundamental building block',
    'PRO_TEST_EMAIL',
    'FREE_TEST_EMAIL',
    'CANARY_PAID_PASSWORD',
    'CANARY_TRIAL_PASSWORD',
    'pl002-basic-useful-session',                         // historical evidence slug (not basic-user)
  ])('IGNORES %s', (s) => { expect(anyMatch(s)).toBe(false); });
});
