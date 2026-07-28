import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error — plain .mjs script, intentionally dependency-free for the Vercel build step.
import { decideExitCode, PREVIEW_MARKER, EXIT_BUILD, EXIT_SKIP } from '../../scripts/vercel-ignore-build.mjs';

/**
 * #1043: Vercel's Ignored Build Step uses an INVERTED contract — exit 1 CONTINUES the build, exit 0 SKIPS it.
 * Getting this backwards would either burn a build on every PR commit or silently never produce the
 * authorized compatibility preview, so all four cases are locked here.
 */
describe('#1043 vercel ignore-build contract (exit 1 = BUILD, exit 0 = SKIP)', () => {
    it('production ALWAYS builds — marker irrelevant', () => {
        expect(decideExitCode('production', 'chore: no marker here')).toBe(EXIT_BUILD);
        expect(decideExitCode('production', `feat: something ${PREVIEW_MARKER}`)).toBe(EXIT_BUILD);
        expect(decideExitCode('production', undefined)).toBe(EXIT_BUILD);
    });

    it('preview WITH the marker builds (explicit opt-in)', () => {
        expect(decideExitCode('preview', `perf(stt): checkpoint ${PREVIEW_MARKER}`)).toBe(EXIT_BUILD);
        expect(decideExitCode('preview', `${PREVIEW_MARKER} leading marker`)).toBe(EXIT_BUILD);
        expect(decideExitCode('preview', `multi\nline\nbody ${PREVIEW_MARKER}\nfooter`)).toBe(EXIT_BUILD);
    });

    it('preview WITHOUT the marker skips — normal PR commits stay cheap', () => {
        expect(decideExitCode('preview', 'fix: ordinary commit')).toBe(EXIT_SKIP);
        expect(decideExitCode('preview', '')).toBe(EXIT_SKIP);
        expect(decideExitCode('preview', undefined)).toBe(EXIT_SKIP);
        // Near-misses must NOT trigger a build.
        expect(decideExitCode('preview', 'vercel-preview without brackets')).toBe(EXIT_SKIP);
    });

    it('missing or unknown environment skips SAFELY — never builds implicitly', () => {
        expect(decideExitCode(undefined, `has marker ${PREVIEW_MARKER}`)).toBe(EXIT_SKIP);
        expect(decideExitCode('', `has marker ${PREVIEW_MARKER}`)).toBe(EXIT_SKIP);
        expect(decideExitCode('development', `has marker ${PREVIEW_MARKER}`)).toBe(EXIT_SKIP);
        expect(decideExitCode('staging', 'anything')).toBe(EXIT_SKIP);
    });

    it('the inverted exit-code constants are not accidentally swapped', () => {
        expect(EXIT_BUILD).toBe(1);
        expect(EXIT_SKIP).toBe(0);
    });

    it('vercel.json wires the version-controlled ignoreCommand (not a dashboard-only rule)', () => {
        const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf8')) as {
            ignoreCommand?: string;
        };
        expect(cfg.ignoreCommand).toBe('node scripts/vercel-ignore-build.mjs');
    });
});
