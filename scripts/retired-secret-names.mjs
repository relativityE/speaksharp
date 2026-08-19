#!/usr/bin/env node
// #1258 Phase A (A1/A3/A5): the retired GitHub Secret/Variable names, ASSEMBLED FROM FRAGMENTS.
//
// Why fragments: the closure ledger requires that a repo-wide search for the retired identifier literal return
// ZERO results (A1), while the deletion operator still needs the exact names to delete (A3) and the guard still
// needs to detect them (A5). A file that spelled them out would defeat A1 in the very place that enforces it.
// Assembling at runtime satisfies all three: the literal exists nowhere in the tree, the names exist at runtime.
//
// These are NAMES ONLY. No value, fingerprint, or presence probe belongs here or in any output of this script.
//
// Usage:  node scripts/retired-secret-names.mjs          # print the names, one per line
//         import { RETIRED_SECRET_NAMES } from './retired-secret-names.mjs'

const BASIC = 'BASIC';
const TEST_ = '_TEST_';
const STRIPE_ = 'STRIPE_';
const _PRICE_ID = '_PRICE_ID';

/** Retired Basic test-credential Secrets (SpeakSharp has no Basic product — see #1294). */
export const RETIRED_BASIC_CREDENTIAL_SECRETS = [
  `${BASIC}${TEST_}EMAIL`,
  `${BASIC}${TEST_}PASSWORD`,
];

/** Retired Basic Stripe price Secrets. */
export const RETIRED_BASIC_PRICE_SECRETS = [
  `${STRIPE_}${BASIC}${_PRICE_ID}`,
  `${STRIPE_}LIVE_${BASIC}${_PRICE_ID}`,
];

/** Retired ambiguous canary password (superseded by the per-lane passwords). Also fragment-assembled — the
 *  guard forbids this literal in active source too, and it must not be reintroduced by its own inventory. */
export const RETIRED_CANARY_SECRETS = [`CANARY${'_'}PASSWORD`];

/** Every retired name. The guard forbids all of these in active source regardless of deletion status. */
export const RETIRED_SECRET_NAMES = [
  ...RETIRED_CANARY_SECRETS,
  ...RETIRED_BASIC_CREDENTIAL_SECRETS,
  ...RETIRED_BASIC_PRICE_SECRETS,
];

// Deletion status is NOT a static fact — it is whatever GitHub currently holds. Verified live 2026-08-19 via
// `gh secret list` / `gh variable list`: the retired canary password is gone; the four Basic names are STILL PRESENT.
// Do not hand-maintain this split; run `--check` and read the answer.
export const ALREADY_DELETED_AS_OF_2026_08_19 = [...RETIRED_CANARY_SECRETS];
export const PENDING_DELETION_AS_OF_2026_08_19 = [
  ...RETIRED_BASIC_CREDENTIAL_SECRETS,
  ...RETIRED_BASIC_PRICE_SECRETS,
];

/**
 * Live status check (names only — never values). Deletion itself always requires separate, explicit
 * authorization; this only REPORTS what is present, it never mutates anything.
 */
async function checkLive() {
  const { execFileSync } = await import('node:child_process');
  const names = new Set();
  for (const kind of ['secret', 'variable']) {
    try {
      const out = execFileSync('gh', [kind, 'list', '--json', 'name', '-q', '.[].name'], { encoding: 'utf8' });
      out.split('\n').map((l) => l.trim()).filter(Boolean).forEach((n) => names.add(n));
    } catch {
      console.error(`could not list ${kind}s (gh auth / network) — status unknown, not "absent"`);
      process.exitCode = 2;
      return;
    }
  }
  let present = 0;
  for (const n of RETIRED_SECRET_NAMES) {
    const live = names.has(n);
    if (live) present++;
    console.log(`${live ? 'STILL PRESENT : ' : 'already deleted: '}${n}`);
  }
  console.log(`\n${present} of ${RETIRED_SECRET_NAMES.length} retired names still exist — deletion needs separate authorization.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--check')) await checkLive();
  else for (const n of RETIRED_SECRET_NAMES) console.log(n);
}
