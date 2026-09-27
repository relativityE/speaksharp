// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * #1537 (Codex P1 r4115978885, PM RETURN 5857492829) — the REST probes of the 20260926190000 postflight must reach the
 * SAME project the migration was applied to. The DB path is bound to SUPABASE_PROJECT_ID (supabase link + the pooler
 * resolved for that project); this helper binds the REST path to it too. Only `https://<ref>.supabase.co`, optionally
 * with one trailing slash, is accepted. A mismatch fails closed WITHOUT printing the URL or the project ref.
 */
const SCRIPT = resolve(import.meta.dirname, '../../scripts/assert-rest-url-bound.sh');
const REF = 'abcdefghijklmnopqrst';
const run = (url, ref) => {
    const env = { PATH: process.env.PATH };
    if (url !== undefined) env.SUPABASE_URL = url;
    if (ref !== undefined) env.SUPABASE_PROJECT_ID = ref;
    const r = spawnSync('bash', [SCRIPT], { env, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('#1537 REST URL is bound to SUPABASE_PROJECT_ID (fail closed, no disclosure)', () => {
    it('POSITIVE: the canonical project URL, with or without one trailing slash', () => {
        expect(run(`https://${REF}.supabase.co`, REF).code).toBe(0);
        expect(run(`https://${REF}.supabase.co/`, REF).code).toBe(0);
    });

    it.each([
        ['another valid project', `https://zyxwvutsrqponmlkjihg.supabase.co`],
        ['a suffix lookalike host', `https://${REF}.supabase.co.evil.example`],
        ['a prefix lookalike host', `https://x${REF}.supabase.co`],
        ['a subdomain lookalike', `https://${REF}.evil.supabase.co`],
        ['userinfo smuggling', `https://${REF}.supabase.co@evil.example`],
        ['plain http', `http://${REF}.supabase.co`],
        ['a trailing path', `https://${REF}.supabase.co/rest/v1`],
        ['a port', `https://${REF}.supabase.co:443`],
        ['two trailing slashes', `https://${REF}.supabase.co//`],
        ['surrounding whitespace', ` https://${REF}.supabase.co`],
        ['an empty URL', ''],
    ])('CASUALTY: %s is refused, and neither value is printed', (_label, url) => {
        const r = run(url, REF);
        expect(r.code).not.toBe(0);
        expect(r.out).toContain('REST URL is not bound to SUPABASE_PROJECT_ID');
        expect(r.out).not.toContain(REF);
        expect(url.trim() !== '' && r.out.includes(url.trim())).toBe(false);
    });

    it('CASUALTY: a missing URL or project ref is refused', () => {
        expect(run(undefined, REF).code).not.toBe(0);
        expect(run(`https://${REF}.supabase.co`, undefined).code).not.toBe(0);
        expect(run(`https://${REF}.supabase.co`, '').code).not.toBe(0);
    });

    it('CASUALTY: a project ref that is not a plain lowercase ref is refused (no pattern injection)', () => {
        for (const bad of ['*', '.*', 'abc.def', 'ABCDEFGHIJKLMNOPQRST', 'abc def']) {
            const r = run('https://anything.supabase.co', bad);
            expect(r.code).not.toBe(0);
        }
    });
});
