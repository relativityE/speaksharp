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
    + 'that no longer exists: the objective card now renders WITHOUT the soon badge and starts a session, '
    + 'and the string "Product not available at this time" is absent from frontend/src. There is no '
    + 'equivalent element to retarget, so this is a superseded PRODUCT contract needing a #1018 decision, '
    + 'not a rename. Fixing the selector alone would make a dead flow look alive.',
};

function readAllSource(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) readAllSource(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(readFileSync(full, 'utf8'));
  }
  return acc;
}

const SOURCE = readAllSource('frontend/src').join('\n');

/** Only PLAIN STRING literals — a template literal is built at runtime and cannot be checked here. */
function liveSpecSelectors() {
  const found = new Map();
  for (const file of readdirSync('tests/live')) {
    if (!file.endsWith('.live.spec.ts')) continue;
    const text = readFileSync(join('tests/live', file), 'utf8');
    for (const m of text.matchAll(/getByTestId\('([a-zA-Z0-9_-]+)'\)/g)) {
      if (!found.has(m[1])) found.set(m[1], new Set());
      found.get(m[1]).add(file);
    }
  }
  return found;
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
      if (!SOURCE.includes(tid)) unresolved.push(`${tid} (used by ${[...files].sort().join(', ')})`);
    }
    // A non-empty array here means a dispatch WOULD fail against production. The diff names each
    // offending selector and the live spec that uses it.
    expect(unresolved).toEqual([]);
  });

  it('the known-stale quarantine self-expires — a resolving entry must be removed', () => {
    const resurrected = Object.keys(KNOWN_STALE).filter((tid) => SOURCE.includes(tid));
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
