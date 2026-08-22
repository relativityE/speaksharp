import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// #1306 — falsification for scripts/postflight-migration-state.sh.
//
// This is the assertion that would have caught a silent broadening: if a postflight run ever reports
// green while the HELD activation migration (20260812042000) has been applied, the whole exactness
// contract is void. It must also fail closed on a missing/empty/garbled capture rather than passing
// for lack of contrary evidence.

const SCRIPT = resolve(process.cwd(), 'scripts/postflight-migration-state.sh');
const TARGET = '20260819120000';
const HELD = '20260812042000';

let dir;
beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'postflight-state-'));
    chmodSync(SCRIPT, 0o755);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Run the script; return {ok, out} instead of throwing so failures are assertable. */
function run(listText, target = TARGET, held = [HELD]) {
    const file = join(dir, `list-${Math.abs(hash(listText + target + held.join()))}.txt`);
    writeFileSync(file, listText);
    try {
        const out = execFileSync('bash', [SCRIPT, file, target, ...held], { encoding: 'utf8' });
        return { ok: true, out: out.trim() };
    } catch (e) {
        return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() };
    }
}
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

// Build a `supabase migration list` capture from explicit rows. Earlier drafts mutated a template
// string with .replace(); a trailing-space mismatch made two "falsification" cases silently no-op and
// PASS — a test that proves nothing is worse than no test. Rows are now constructed, never patched.
const row = (version, applied) =>
    `   ${version} | ${applied ? version : '              '} | 2026-08-19 12:00:00`;

const buildList = (rows) =>
    ['   Local          | Remote         | Time (UTC)',
     '  ----------------|----------------|---------------------',
     ...rows].join('\n') + '\n';

// The real post-apply production state: target applied, held still pending.
const GOOD_LIST = buildList([
    row(HELD, false),
    row('20260816223606', true),
    row('20260817140000', true),
    row(TARGET, true),
]);

describe('postflight-migration-state — the reviewed production state passes', () => {
    it('accepts target applied + held pending', () => {
        const r = run(GOOD_LIST);
        expect(r.ok).toBe(true);
        expect(r.out).toContain('postflight_state_ok');
    });

    it('the fixture builder actually distinguishes applied from pending (anti-no-op guard)', () => {
        expect(row(HELD, true)).not.toBe(row(HELD, false));
        expect(GOOD_LIST).not.toBe(buildList([row(HELD, true), row(TARGET, true)]));
    });
});

describe('postflight-migration-state — falsification', () => {
    it('FAILS when the held migration was applied (silent broadening)', () => {
        const r = run(buildList([row(HELD, true), row(TARGET, true)]));
        expect(r.ok).toBe(false);
        expect(r.out).toContain(`postflight_state_held_was_applied:${HELD}`);
    });

    it('FAILS when the target is still pending (postflight run against an unapplied target)', () => {
        const r = run(buildList([row(HELD, false), row(TARGET, false)]));
        expect(r.ok).toBe(false);
        expect(r.out).toContain(`postflight_state_target_not_applied:${TARGET}`);
    });

    it('FAILS when the target is absent from the list entirely', () => {
        const r = run(GOOD_LIST.split('\n').filter((l) => !l.includes(TARGET)).join('\n'));
        expect(r.ok).toBe(false);
        expect(r.out).toContain(`postflight_state_target_absent_from_list:${TARGET}`);
    });

    it('FAILS when a held migration vanishes from the list (absence is not a pass)', () => {
        const r = run(GOOD_LIST.split('\n').filter((l) => !l.includes(HELD)).join('\n'));
        expect(r.ok).toBe(false);
        expect(r.out).toContain(`postflight_state_held_absent_from_list:${HELD}`);
    });

    it('FAILS closed on an empty capture', () => {
        const r = run('');
        expect(r.ok).toBe(false);
        expect(r.out).toContain('postflight_state_empty_capture');
    });

    it('FAILS closed on a missing capture file', () => {
        let ok = true; let out = '';
        try {
            out = execFileSync('bash', [SCRIPT, join(dir, 'does-not-exist.txt'), TARGET, HELD], { encoding: 'utf8' });
        } catch (e) { ok = false; out = `${e.stdout ?? ''}${e.stderr ?? ''}`; }
        expect(ok).toBe(false);
        expect(out).toContain('postflight_state_missing_list_file');
    });

    it('does not match a version that appears only in a timestamp or path', () => {
        // The version string embedded in a filename must not satisfy the applied check.
        const r = run(`
   Local          | Remote         | Time (UTC)
   20260812042000 |                | 2026-08-12 04:20:00
  note: applied supabase/migrations/${TARGET}_complete_session_v2.sql earlier
`);
        expect(r.ok).toBe(false);
        expect(r.out).toContain(`postflight_state_target_absent_from_list:${TARGET}`);
    });
});
