import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { RETIRED_SECRET_NAMES } from '../../scripts/retired-secret-names.mjs';

// #1258 A1/A5 — REPOSITORY-WIDE retired-literal contract.
//
// The #1294 guard (no-legacy-basic-canary-tokens.test.js) scans ACTIVE source only: it deliberately excludes
// pinned archives, evidence, and the meta-files that must name a token in order to assert its absence. This
// contract is the stricter, complementary one the closure ledger asks for: the retired identifier literals must
// appear **ZERO** times in the ENTIRE tracked tree — archives and audits included. (The archives were redacted
// to `[RETIRED_CANARY_PW]`; see the note at the top of each.)
//
// Like every guard here, it assembles the forbidden literals from fragments, so enforcing the contract can never
// be the thing that violates it. There are NO exemptions by design — an exemption list would reintroduce exactly
// the "it's fine, it's only in a doc" drift this exists to stop.

// Every retired name: the Basic test-credential Secrets, the Basic Stripe price Secrets, and the ambiguous
// single canary password. All five were deleted from GitHub on 2026-08-19; the literals stay forbidden so a
// future edit cannot quietly resurrect a name that no longer resolves to anything.
const FORBIDDEN_LITERALS = [...RETIRED_SECRET_NAMES];

/** Every tracked file, from git itself — so an untracked scratch file can never mask or trip the contract. */
function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

/** Binary-safe: a file that is not valid UTF-8 text cannot carry the literal in a meaningful sense. */
function readTextOrNull(p) {
  try {
    const buf = readFileSync(p);
    if (buf.includes(0)) return null;               // NUL byte -> binary
    return buf.toString('utf8');
  } catch { return null; }
}

describe('#1258 A1 — retired credential literals are absent from the ENTIRE tracked tree', () => {
  const files = trackedFiles();

  it('enumerates the tracked tree (contract is not silently empty)', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  // The title must NOT interpolate the literal — a test name is echoed into CI logs, and the whole point is
  // that this string does not get reproduced anywhere. Index it instead.
  it.each(FORBIDDEN_LITERALS.map((literal, index) => ({ literal, index })))(
    'has exactly zero occurrences of retired literal #$index',
    ({ literal }) => {
      const hits = [];
      for (const rel of files) {
        const text = readTextOrNull(rel);
        if (text == null || !text.includes(literal)) continue;
        text.split(/\r?\n/).forEach((line, i) => {
          if (line.includes(literal)) hits.push(`${rel}:${i + 1}`);
        });
      }
      // Surface the offending locations on failure without expect()'s second argument, which
      // `vitest/valid-expect` rejects (the repo lints with --max-warnings 0).
      if (hits.length > 0) {
        throw new Error(
          `retired literal must not appear anywhere in the tracked tree (found ${hits.length}):\n${hits.join('\n')}\n` +
          'Assemble it from fragments via scripts/retired-secret-names.mjs instead of spelling it out.',
        );
      }
      expect(hits).toEqual([]);
    },
  );
});

describe('#1258 A1 contract self-test — it would actually catch a reintroduction', () => {
  it('detects the literal in a synthetic line', () => {
    for (const literal of FORBIDDEN_LITERALS) {
      expect(`  FOO: \${{ secrets.${literal} }}`.includes(literal)).toBe(true);
    }
  });

  it('does not flag the current canary lane names', () => {
    for (const ok of ['CANARY_TRIAL_PASSWORD', 'CANARY_PAID_PASSWORD', 'CANARY_LANE_PASSWORD',
                      'FREE_TEST_EMAIL', 'FREE_TEST_PASSWORD', 'PRO_TEST_EMAIL', 'PRO_TEST_PASSWORD',
                      'CANARY_TRIAL_EMAIL', 'CANARY_PAID_EMAIL']) {
      expect(FORBIDDEN_LITERALS.some((l) => ok.includes(l))).toBe(false);
    }
  });
});
