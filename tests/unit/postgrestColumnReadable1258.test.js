// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * #1537 (Codex P1 r4112619095, PM RETURN 5849624832) — the fail-closed decision behind the product-marker postflight.
 *
 * After `20260926190000` applies and PostgREST is told to reload, the workflow reads `sessions.product` through the SAME
 * REST API the client uses, as a NO-ROW read (a nonexistent id, `limit=0`). It is confirmed ONLY by HTTP 200 with the
 * exact empty array `[]`. A stale schema cache, a missing column, an auth/network failure, a PostgREST error riding a
 * 200, or ANY returned row (the probe must never read user data) is not confirmed.
 */
const SCRIPT = resolve(import.meta.dirname, '../../scripts/postgrest-column-readable.sh');
const dir = mkdtempSync(join(tmpdir(), 'col-readable-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const decide = (code, body) => {
    const f = join(dir, `b${n++}.json`);
    writeFileSync(f, body);
    try { execFileSync('bash', [SCRIPT, code, f], { stdio: 'pipe' }); return 0; } catch (e) { return e.status ?? 1; }
};

describe('#1537 postflight — sessions.product readable through PostgREST (fail closed)', () => {
    it('CONFIRMS only HTTP 200 with the exact empty array (a resolved, no-row read)', () => {
        expect(decide('200', '[]')).toBe(0);
        expect(decide('200', '[]\n')).toBe(0);
        expect(decide('200', ' [ ] ')).toBe(0);
    });

    it('STALE CACHE / MISSING COLUMN is not confirmed (42703, PGRST204, PGRST100)', () => {
        expect(decide('400', '{"code":"42703","message":"column sessions.product does not exist"}')).not.toBe(0);
        expect(decide('400', '{"code":"PGRST204","message":"Could not find the \'product\' column of \'sessions\' in the schema cache"}')).not.toBe(0);
        expect(decide('400', '{"code":"PGRST100","message":"failed to parse select parameter"}')).not.toBe(0);
    });

    it('a PostgREST or SQLSTATE error riding a 200 is not confirmed', () => {
        expect(decide('200', '{"code":"PGRST204"}')).not.toBe(0);
        expect(decide('200', '{"code":"42703"}')).not.toBe(0);
    });

    it('transport, auth and server failures are not confirmed', () => {
        expect(decide('000', '')).not.toBe(0);
        expect(decide('', '[]')).not.toBe(0);
        expect(decide('401', '{"message":"Invalid API key"}')).not.toBe(0);
        expect(decide('403', 'Forbidden')).not.toBe(0);
        expect(decide('404', '<html>not found</html>')).not.toBe(0);
        expect(decide('500', '{"message":"internal"}')).not.toBe(0);
        expect(decide('503', '[]')).not.toBe(0);
    });

    it('an empty, malformed or non-array body is not confirmed', () => {
        expect(decide('200', '')).not.toBe(0);
        expect(decide('200', 'not json')).not.toBe(0);
        expect(decide('200', '{}')).not.toBe(0);
        expect(decide('200', 'null')).not.toBe(0);
    });

    it('ANY returned row is not confirmed — the probe is a no-row read and must never carry user data', () => {
        expect(decide('200', '[{"id":"00000000-0000-0000-0000-000000000000","product":null}]')).not.toBe(0);
        expect(decide('200', '[{}]')).not.toBe(0);
    });

    it('a missing body file is not confirmed', () => {
        expect(() => execFileSync('bash', [SCRIPT, '200', join(dir, 'absent.json')], { stdio: 'pipe' })).toThrow();
    });
});
