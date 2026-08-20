// @vitest-environment node
//
// #1314 — mutation tests for the fail-closed reload decision (scripts/postgrest-reload-confirmed.sh). The PM
// required: network error, 401/403/404, 5xx, malformed body, and PGRST202 all FAIL; only the frozen expected
// resolved-function response passes.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/postgrest-reload-confirmed.sh');
const dir = mkdtempSync(path.join(tmpdir(), 'reload-'));

/** run the decision; returns exit code (0 = confirmed). */
function decide(code: string, body: string): number {
  const f = path.join(dir, `b-${Math.abs(hash(code + body))}.json`);
  writeFileSync(f, body);
  try { execFileSync('bash', [SCRIPT, code, f], { stdio: 'pipe' }); return 0; }
  catch (e: unknown) { return (e as { status?: number }).status ?? 1; }
}
function hash(s: string): number { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

describe('#1314 reload decision is fail-closed', () => {
  it('CONFIRMS only a 200 with the frozen resolved-function body', () => {
    expect(decide('200', '{"success":false,"error":"profile_not_found"}')).toBe(0);
    expect(decide('200', '{"success":false,"error":"session_not_found"}')).toBe(0);
  });

  it('REJECTS PGRST202 (function not found) — absence-of-PGRST202 is not the test', () => {
    expect(decide('404', '{"code":"PGRST202","message":"Could not find the function"}')).not.toBe(0);
    // even a 200 that somehow carried a PGRST error must not count
    expect(decide('200', '{"code":"PGRST202"}')).not.toBe(0);
  });

  it('REJECTS a network/curl failure (no response)', () => {
    expect(decide('000', '')).not.toBe(0);
  });

  it('REJECTS auth failures 401/403', () => {
    expect(decide('401', '{"message":"JWT expired"}')).not.toBe(0);
    expect(decide('403', 'Forbidden')).not.toBe(0);
  });

  it('REJECTS a 404 HTML error page', () => {
    expect(decide('404', '<html><body>not found</body></html>')).not.toBe(0);
  });

  it('REJECTS 5xx', () => {
    expect(decide('500', '{"message":"internal error"}')).not.toBe(0);
    expect(decide('502', 'Bad Gateway')).not.toBe(0);
  });

  it('REJECTS a malformed / empty body even with a 200', () => {
    expect(decide('200', '')).not.toBe(0);
    expect(decide('200', 'not json at all')).not.toBe(0);
    expect(decide('200', '{"success":true}')).not.toBe(0);   // 200 but not the frozen non-mutating contract
  });

  it('REJECTS any other PostgREST error body', () => {
    expect(decide('400', '{"code":"PGRST100","message":"parse error"}')).not.toBe(0);
  });
});
