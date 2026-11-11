// @vitest-environment node
/** Review RETURN on #1815 bb4b0c3c: the post-release sign-in smoke is bound to the release under test, fail closed. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { requiresReleaseBinding, servedReleaseVerdict } from '../live/helpers/servedReleaseBinding';

const R = '5ffbbb93c34371d1960f01d4713a1fa656887d73';
const OTHER = 'fe76a8010cc0000000000000000000000000000a';

describe('servedReleaseVerdict', () => {
    it('PASS only when the page names exactly the release under test', () => {
        expect(servedReleaseVerdict(R, R)).toEqual({ ok: true, release: R });
        expect(servedReleaseVerdict(` ${R} `, R)).toEqual({ ok: true, release: R });
    });
    it.each([
        [R, OTHER, 'mismatch'],
        [R, R.slice(0, 8), 'observed-malformed'],
        [R, R.toUpperCase(), 'observed-malformed'],
        [R, null, 'observed-missing'],
        [R, '', 'observed-missing'],
        [R, 7, 'observed-malformed'],
        ['', R, 'expected-missing'],
        [undefined, R, 'expected-missing'],
        [R.slice(0, 12), R, 'expected-malformed'],
    ])('CASUALTY expected=%s observed=%s → %s', (expected, observed, reason) => {
        expect(servedReleaseVerdict(expected as string | undefined, observed)).toEqual({ ok: false, reason });
    });
});

describe('requiresReleaseBinding', () => {
    it('every deployed target needs a binding; only a local dev target may omit it; unknown fails closed', () => {
        for (const u of ['https://speaksharp-public.vercel.app/', 'https://preview-x.vercel.app', undefined, '', 'not a url']) expect(requiresReleaseBinding(u)).toBe(true);
        for (const u of ['http://localhost:5174', 'http://127.0.0.1:4173', 'http://app.localhost:3000']) expect(requiresReleaseBinding(u)).toBe(false);
    });
});

describe('wiring', () => {
    it('the sign-in spec binds to EXPECT_RELEASE_SHA (never the dispatch EXPECTED_RELEASE_SHA) and asserts the verdict', () => {
        const spec = readFileSync('tests/live/auth.live.spec.ts', 'utf8');
        expect(spec).toContain("process.env.EXPECT_RELEASE_SHA");
        expect(spec).not.toMatch(/EXPECTED_RELEASE_SHA/);
        expect(spec.match(/servedReleaseVerdict\(/g)?.length).toBe(2);
        expect(spec).toContain('DEFAULT_AUTH_LANDING');
    });
    it('the exact-SHA proof workflow runs the sign-in smoke with the same expect_sha input', () => {
        const wf = readFileSync('.github/workflows/private-recording-proof.yml', 'utf8');
        const step = wf.slice(wf.indexOf('Run existing-account sign-in smoke'));
        expect(step).toContain('EXPECT_RELEASE_SHA: ${{ github.event.inputs.expect_sha }}');
        expect(step).toContain('tests/live/auth.live.spec.ts');
        expect(step).toContain('FREE_TEST_PASSWORD: ${{ secrets.FREE_TEST_PASSWORD }}');
    });
});
