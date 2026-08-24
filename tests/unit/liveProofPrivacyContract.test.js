// LIVE-PROOF PRIVACY CONTRACT — workflow-visible text must be identifier-free.
//
// WHY. A live proof runs in a PUBLIC Actions log. Success evidence was already content-free, but the
// FAILURE paths were not: thrown errors interpolated the run-owned cleanup UID, the generated email,
// and session UUIDs, and a failing Playwright locator serializes the exact session id it was built
// from. A proof that only protects its happy path protects nothing — failures are exactly when the
// log gets read and shared.
//
// This scans what a run can PRINT, not what it computes: the identifiers are still used internally
// for scoping, they simply must not reach a message.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const LIVE_DIRS = ['tests/live', 'tests/live/helpers'];

/** Variables that hold run-owned identifiers. Interpolating any of these into printed text leaks it. */
const IDENTIFIER_BINDINGS = [
  'capturedUid', 'createdEmail', 'foundEmail', 'persistedId', 'sessionId', 'capturedEmail',
];

function liveFiles() {
  const out = [];
  for (const dir of LIVE_DIRS) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.ts')) out.push(join(dir, f));
    }
  }
  return out;
}

/**
 * Extract every argument text of `throw new Error(...)` and `console.log(...)` — the two ways this
 * harness puts words into the public log.
 */
function printedExpressions(text) {
  const out = [];
  const re = /(?:throw new Error\(|console\.(?:log|error|warn)\()/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
    }
    out.push(text.slice(start, i - 1));
  }
  return out;
}

describe('live-proof privacy contract', () => {
  const files = liveFiles();
  const scanned = files.map((f) => ({ file: f, printed: printedExpressions(readFileSync(f, 'utf8')) }));

  it('POSITIVE CONTROL — the scan actually found printed expressions to inspect', () => {
    // Without this, a broken extractor would report "no leaks" over an empty set forever.
    const total = scanned.reduce((n, s) => n + s.printed.length, 0);
    expect(files.length).toBeGreaterThan(2);
    expect(total).toBeGreaterThan(10);
  });

  it('no run-owned identifier binding is interpolated into any printed message', () => {
    const leaks = [];
    for (const { file, printed } of scanned) {
      for (const expr of printed) {
        for (const binding of IDENTIFIER_BINDINGS) {
          // `${binding}` or `${binding.something}` inside a printed expression.
          if (new RegExp(`\\$\\{\\s*${binding}\\b`).test(expr)) {
            leaks.push(`${file}: \${${binding}} in a printed message`);
          }
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  // The #1306 production-proof surface — the files #1338 owns. A raw `error.message` from PostgREST
  // can echo the filter it was built from, including the session UUID; `error.code` cannot.
  const STRICT_FILES = [
    'tests/live/three-session-retention-proof.live.spec.ts',
    'tests/live/private-recording-proof.live.spec.ts',
    'tests/live/helpers/runOwnedCleanup.ts',
    'tests/live/helpers/entitlementAuthority.ts',
  ];

  /**
   * Live proofs OUTSIDE the #1306 surface that still print raw error text. Each is a separate proof
   * with its own owner, so sweeping them here would edit specs this ticket does not own. Listed rather
   * than silently excluded, and self-expiring: the last test fails if one of these stops leaking and
   * the entry is not removed.
   */
  const QUARANTINED_FILES = {
    'tests/live/helpers/benchmark-utils.ts': 'shared benchmark harness; dumps a UI-state snapshot plus a JS Error message on precondition failure — needs its own sweep so other benchmark specs keep their diagnostics',
    'tests/live/stripe-billing-portal-readiness.live.spec.ts': 'separate billing proof, not the #1306 surface',
    'tests/live/tester-b-private-native-stt.live.spec.ts': 'separate tester proof, not the #1306 surface',
    'tests/live/upgrade.live.spec.ts': 'separate upgrade proof, not the #1306 surface',
  };

  const printsRawMessage = (expr) => /\$\{[^}]*\berr(?:or)?\w*\.message\b/.test(expr);

  it('the #1306 proof surface never prints a raw provider error message', () => {
    const leaks = [];
    for (const { file, printed } of scanned) {
      if (!STRICT_FILES.includes(file)) continue;
      for (const expr of printed) {
        if (printsRawMessage(expr)) leaks.push(`${file}: raw provider .message printed`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('STRICT_FILES actually exist and were scanned (not a typo that silently checks nothing)', () => {
    const scannedNames = scanned.map((s) => s.file);
    for (const f of STRICT_FILES) expect(scannedNames).toContain(f);
  });

  it('the raw-message quarantine self-expires — a clean file must be removed from it', () => {
    const clean = Object.keys(QUARANTINED_FILES).filter((f) => {
      const entry = scanned.find((s) => s.file === f);
      return entry && !entry.printed.some(printsRawMessage);
    });
    expect(clean).toEqual([]);
  });

  it('the cleanup verdict line is content-free', () => {
    const helper = readFileSync('tests/live/helpers/runOwnedCleanup.ts', 'utf8');
    const verdict = printedExpressions(helper).find((e) => e.includes('RUN_OWNED_CLEANUP'));
    expect(verdict, 'cleanup must emit an explicit verdict line').toBeTruthy();
    for (const binding of IDENTIFIER_BINDINGS) {
      expect(new RegExp(`\\$\\{\\s*${binding}\\b`).test(verdict), `verdict leaks ${binding}`).toBe(false);
    }
  });
});
