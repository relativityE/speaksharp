// LIVE-SPEC SELECTOR CONTRACT — static guard for proofs CI can never execute.
//
// WHY THIS EXISTS. Live proofs are `workflow_dispatch`-only: they need production, real credentials
// and a real browser, so no CI run ever executes them. That makes them uniquely vulnerable to silent
// rot — a renamed `data-testid` breaks them and nothing notices until someone dispatches the proof.
//
// That is not hypothetical. Commit 043c980b (#1149 N2.3) renamed the practice cards `quick` ->
// `freeform` and `guided` -> `objective` in the app but did not update tests/live. The #1089 exact-SHA
// production proof was therefore unable to run from that day onward, and nobody knew. The #1306
// three-session proof inherited the same stale selector by being modelled on it, and its first
// production dispatch failed 28.7s in — AFTER creating a real run-owned account — on a defect that was
// fully detectable statically, for free, before any production write.
//
// CI cannot run these specs. It CAN prove their selectors still resolve, which is what this does.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Selectors that are KNOWN to no longer exist and are awaiting a product-contract decision rather
 * than a mechanical rename. Each entry must name why. This list is self-expiring: a second test fails
 * if an entry starts resolving again, so a fixed selector cannot linger here and quietly weaken the
 * guard.
 */
const KNOWN_STALE = {
  'guided-unavailable-notice':
    'report-page-context §C (#1018 Issue-Report proof) asserts a "guided rehearsal unavailable" flow '
    + 'that no longer exists: the objective card now renders WITHOUT the soon badge and starts a session. '
    + 'Superseded PRODUCT contract needing a #1018 decision, not a rename.',

  // ---- #1184 removed the STT mode selector from the product (commit edb31d3c, "Private-only STT —
  // resolution defanged + selector removed"). The testId CONSTANTS survive; nothing renders them. ----
  'stt-mode-select':
    'Removed from the product by #1184 (Private-only STT). benchmark-utils no longer BLOCKS on it — it '
    + 'verifies the resolved runtime mode instead — but driver-dependent/private-stt still references it '
    + 'and needs its own Private-only reconciliation. Post-MVP; does not block the #1306 proof.',
  'stt-mode-private':
    'Same #1184 selector removal; referenced only by driver-dependent/private-stt. Post-MVP.',
  'private-first-run-note':
    'Not rendered, but every use is TOLERANT (isVisible().catch(() => false) and a diagnostic '
    + 'querySelector), so it cannot block a run. Dead reference to clean up post-MVP.',

  // ---- Referenced by live proofs outside the #1306 path; each needs its own owner. ----
  'take-over-recording': 'account-wide-recording-mutex proof; selector not rendered. Post-MVP.',
  'account-lease-take-over': 'account-wide-recording-mutex proof; selector not rendered. Post-MVP.',
  'lease-take-over': 'account-wide-recording-mutex proof; selector not rendered. Post-MVP.',
  'wpm-value': 'analytics-live-native-probe proof; selector not rendered. Post-MVP.',
};

function readAllTsx(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) readAllTsx(full, acc);
    else if (entry.endsWith('.tsx')) acc.push(readFileSync(full, 'utf8'));
  }
  return acc;
}

const TSX_SOURCE = readAllTsx('frontend/src').join('\n');
const CONSTANTS_SOURCE = readFileSync('frontend/src/constants/testIds.ts', 'utf8');

/**
 * Only PLAIN STRING literals — a template literal is built at runtime and cannot be checked here.
 *
 * Scans tests/live RECURSIVELY, helpers included. The first version looked at `*.live.spec.ts` only,
 * so `stt-mode-select` — used by benchmark-utils, not by a spec — was never checked, and the #1306
 * production dispatch failed on it after creating a real account.
 */
function liveSpecSelectors(dir = 'tests/live', found = new Map()) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { liveSpecSelectors(full, found); continue; }
    if (!entry.endsWith('.ts')) continue;
    const text = readFileSync(full, 'utf8');
    for (const m of text.matchAll(/getByTestId\('([a-zA-Z0-9_-]+)'\)|data-testid="([a-zA-Z0-9_-]+)"/g)) {
      const tid = m[1] ?? m[2];
      if (!found.has(tid)) found.set(tid, new Set());
      found.get(tid).add(full);
    }
  }
  return found;
}

/**
 * Is this testid actually RENDERED by a component, or does it only survive as a constant?
 *
 * `stt-mode-select` is the cautionary case: #1184 removed the mode selector from the product, but the
 * `STT_MODE_SELECT` entry stayed in testIds.ts. A "does the id appear in frontend/src?" check passed
 * happily while nothing on the page could ever match it. So resolution requires either a literal in a
 * component, or a constant whose NAME is referenced from one.
 */
function isRendered(tid, componentSource, constantsSource) {
  if (componentSource.includes(tid)) return true;             // literal in a .tsx
  const named = constantsSource.match(new RegExp(`([A-Z0-9_]+):\\s*'${tid}'`));
  return named ? componentSource.includes(named[1]) : false;  // constant referenced by a .tsx
}

describe('live-spec selector contract', () => {
  const selectors = liveSpecSelectors();

  it('finds selectors to check at all (the scan must not be vacuous)', () => {
    expect(selectors.size).toBeGreaterThan(10);
  });

  it('every testid a live proof clicks or asserts still exists in frontend/src', () => {
    const unresolved = [];
    for (const [tid, files] of selectors) {
      if (tid in KNOWN_STALE) continue;
      if (!isRendered(tid, TSX_SOURCE, CONSTANTS_SOURCE)) {
        unresolved.push(`${tid} (used by ${[...files].sort().join(', ')})`);
      }
    }
    // A non-empty array here means a dispatch WOULD fail against production. The diff names each
    // offending selector and the live spec that uses it.
    expect(unresolved).toEqual([]);
  });

  it('the known-stale quarantine self-expires — a resolving entry must be removed', () => {
    // Uses the SAME predicate as the main check. Testing with a raw substring search made the two
    // disagree: `stt-mode-select` still exists as a CONSTANT, so a substring test called it resolved
    // while the rendering check correctly called it absent.
    const resurrected = Object.keys(KNOWN_STALE).filter((tid) => isRendered(tid, TSX_SOURCE, CONSTANTS_SOURCE));
    // If this fails: the id exists again, so delete its KNOWN_STALE entry — leaving it would quietly
    // exempt a live selector that the guard could now check for real.
    expect(resurrected).toEqual([]);
  });

  it('every known-stale entry carries a reason', () => {
    for (const [tid, reason] of Object.entries(KNOWN_STALE)) {
      expect(typeof reason === 'string' && reason.length > 40, `${tid} needs a real justification`).toBe(true);
    }
  });
});
