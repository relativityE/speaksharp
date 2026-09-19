import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveLongformCredentials } from '../helpers/longformCredentials';

/**
 * #1500 — THE PRIVATE LONG-FORM PROOF'S IDENTITY IS ONE CONFIGURED PAIR, NEVER A CHECKED-IN LITERAL.
 *
 * The spec used `PRIVATE_LONGFORM_REUSE_PASSWORD ?? <literal>` beside a literal email, in a public
 * repository, in a spec that signs UP first. These cases run in CI without any secret. The behavioural ones
 * exercise the resolver; the static ones guard the wiring, because the defect lived in how the spec
 * sourced its credential, which no function call can reach. This file deliberately does NOT contain the
 * former literal: repeating it here would re-publish it.
 */
describe('#1500 — Private long-form credentials are one atomic configured pair', () => {
    const SPEC = 'tests/live/private-longform-timing.live.spec.ts';
    const HELPER = 'tests/helpers/longformCredentials.ts';
    const spec = readFileSync(SPEC, 'utf8');
    const helper = readFileSync(HELPER, 'utf8');
    const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    it('CASUALTY: a missing password fails closed and names only the variable', () => {
        const result = resolveLongformCredentials({ PRIVATE_LONGFORM_REUSE_EMAIL: 'reuse@example.test' });
        expect(result.ok).toBe(false);
        expect(result.ok ? [] : result.missing).toEqual(['PRIVATE_LONGFORM_REUSE_PASSWORD']);
        expect(result.ok ? '' : result.reason).toMatch(/configuration defect/);
        expect(result.ok ? '' : result.reason).not.toContain('reuse@example.test');
    });

    it('CASUALTY: a missing email fails closed and never echoes the password', () => {
        const result = resolveLongformCredentials({ PRIVATE_LONGFORM_REUSE_PASSWORD: 'configured-secret' });
        expect(result.ok).toBe(false);
        expect(result.ok ? [] : result.missing).toEqual(['PRIVATE_LONGFORM_REUSE_EMAIL']);
        expect(result.ok ? '' : result.reason).not.toContain('configured-secret');
    });

    it('CASUALTY: blank or whitespace members count as absent — no half-configured pair is accepted', () => {
        const blanks = [{}, { PRIVATE_LONGFORM_REUSE_EMAIL: ' ', PRIVATE_LONGFORM_REUSE_PASSWORD: 'x' },
            { PRIVATE_LONGFORM_REUSE_EMAIL: 'a@example.test', PRIVATE_LONGFORM_REUSE_PASSWORD: '\t' }];
        expect(blanks.filter((env) => resolveLongformCredentials(env).ok)).toEqual([]);
    });

    it('POSITIVE CONTROL: a configured pair resolves; the password is returned exactly as configured', () => {
        const result = resolveLongformCredentials({
            PRIVATE_LONGFORM_REUSE_EMAIL: '  reuse@example.test ',
            PRIVATE_LONGFORM_REUSE_PASSWORD: ' pw with spaces ',
        });
        expect(result).toEqual({ ok: true, email: 'reuse@example.test', password: ' pw with spaces ' });
    });

    it('the spec sources its account ONLY through the resolver and fails (never skips) when it is absent', () => {
        expect(spec).toContain("import { resolveLongformCredentials } from '../helpers/longformCredentials';");
        expect(code(spec)).toMatch(/const credentials = resolveLongformCredentials\(\);\s*if \(!credentials\.ok\) throw new Error\(credentials\.reason\);/);
        expect(code(spec)).not.toMatch(/skip\([^)]*credential/i);
    });

    it('CASUALTY: no fallback operator and no string literal can supply this identity again', () => {
        for (const [name, source] of [[SPEC, code(spec)], [HELPER, code(helper)]] as const) {
            // No `??` / `||` default anywhere on a PRIVATE_LONGFORM variable.
            expect(source, `${name}: fallback on a credential variable`).not.toMatch(/PRIVATE_LONGFORM_[A-Z_]+\s*(\?\?|\|\|)/);
            // No quoted literal assigned to an email or password field.
            expect(source, `${name}: literal credential field`).not.toMatch(/\b(email|password)\s*:\s*['"`]/i);
        }
        // No email address literal remains in the spec.
        expect(code(spec)).not.toMatch(/['"`][^'"`\s]+@[^'"`\s]+\.[a-z]{2,}['"`]/i);
    });
});
