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
  'session-start-stop-button':
    'RENDERED BY NOTHING, on any viewport. #1222/#1231 SPLIT the combined toggle into MicCard '
    + '(mic-download / mic-retry / mic-start) and RecorderBar (recorder-stop); MobileActionBar renders '
    + 'the SUFFIXED `-mobile` id only. The #1306 proof path has been fully corrected to the real '
    + 'desktop controls and is covered by EXECUTED helper tests (benchmarkHarnessControls) plus '
    + 'rendered-component tests (MicCard/RecorderBar). The ~14 OTHER live specs still using it are '
    + 'separately owned and each needs its own journey correction — tracked, not fixed here.',

  'take-over-recording': 'account-wide-recording-mutex proof; selector not rendered. Post-MVP.',
  'account-lease-take-over': 'account-wide-recording-mutex proof; selector not rendered. Post-MVP.',
  'lease-take-over': 'account-wide-recording-mutex proof; selector not rendered. Post-MVP.',
  'wpm-value': 'analytics-live-native-probe proof; selector not rendered. Post-MVP.',
};

function readAllTsx(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      readAllTsx(full, acc);
    } else if (entry.endsWith('.tsx') && !entry.includes('.test.')) {
      acc.push(readFileSync(full, 'utf8'));
    }
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
  if (componentSource.includes(`"${tid}"`) || componentSource.includes(`'${tid}'`)) return true;

  // COMPOSED ids: `data-testid={`session-detail-transcript-${view.kind}`}` renders
  // `session-detail-transcript-expired` without that string ever appearing in source. The dynamic tail
  // is unknowable statically, so a matching PREFIX is the strongest available evidence. An empty prefix
  // is rejected — that is the `${CONST}-mobile` shape, where the dynamic part is the HEAD and the
  // rendered id is a different one entirely.
  for (const m of componentSource.matchAll(/data-testid=\{`([^`$]+)\$\{/g)) {
    if (m[1].length > 0 && tid.startsWith(m[1])) return true;
  }

  const named = constantsSource.match(new RegExp(`([A-Z0-9_]+):\\s*'${tid}'`));
  if (!named) return false;
  const constant = named[1];

  // A constant reference is only evidence of RENDERING the bare id if it is used bare. MobileActionBar
  // writes `data-testid={`${TEST_IDS.SESSION_START_STOP_BUTTON}-mobile`}` — it renders the SUFFIXED id,
  // and nothing renders the bare one. The old check saw the constant name and returned true, which is
  // how a selector that resolves on no viewport passed this guard while attempt 5 spent 40 production
  // minutes clicking it. Interpolations that carry a suffix are therefore not counted.
  // Count references, then subtract the ones that only appear inside a template literal that carries
  // MORE content after the interpolation — those render a DIFFERENT, suffixed id.
  const refs = componentSource.match(new RegExp(`\\b${constant}\\b`, 'g')) ?? [];
  const suffixedOnly = componentSource.match(
    new RegExp('`[^`]*\\$\\{[^}]*\\b' + constant + '\\b[^}]*\\}[^`]+`', 'g'),
  ) ?? [];
  return refs.length > suffixedOnly.length;
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
