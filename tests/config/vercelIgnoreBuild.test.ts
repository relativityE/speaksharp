import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error — plain .mjs script, intentionally dependency-free for the Vercel build step.
import { decideExitCode, PREVIEW_BRANCH_PREFIX, EXIT_BUILD, EXIT_SKIP } from '../../scripts/vercel-ignore-build.mjs';

/**
 * #1043: Vercel's Ignored Build Step uses an INVERTED contract — exit 1 CONTINUES the build, exit 0 SKIPS it.
 * Getting this backwards would either burn a build on every PR commit or silently never produce the
 * authorized compatibility preview, so all four cases are locked here.
 *
 * Opt-in is a `preview/*` BRANCH PREFIX (a deliberate act that pins an exact SHA and can be deleted after
 * evidence collection) — not a commit-message marker (easy to paste in by accident) and not a committed
 * flag file (could be merged to `main` and inherited by every future branch).
 */
describe('#1043 vercel ignore-build contract (exit 1 = BUILD, exit 0 = SKIP)', () => {
    it('production ALWAYS builds — branch irrelevant', () => {
        expect(decideExitCode('production', 'main')).toBe(EXIT_BUILD);
        expect(decideExitCode('production', 'preview/anything')).toBe(EXIT_BUILD);
        expect(decideExitCode('production', undefined)).toBe(EXIT_BUILD);
    });

    it('preview on a `preview/*` branch builds (deliberate opt-in)', () => {
        expect(decideExitCode('preview', 'preview/1043-mt-wasm')).toBe(EXIT_BUILD);
        expect(decideExitCode('preview', `${PREVIEW_BRANCH_PREFIX}anything/nested`)).toBe(EXIT_BUILD);
    });

    it('preview on any other branch skips — ordinary PR commits stay cheap', () => {
        expect(decideExitCode('preview', 'perf/1043-private-v2-multithread-wasm')).toBe(EXIT_SKIP);
        expect(decideExitCode('preview', 'fix/some-bug')).toBe(EXIT_SKIP);
        expect(decideExitCode('preview', '')).toBe(EXIT_SKIP);
        expect(decideExitCode('preview', undefined)).toBe(EXIT_SKIP);
        // Near-misses must NOT trigger a build: the prefix is anchored at the start and needs the slash.
        expect(decideExitCode('preview', 'preview-1043')).toBe(EXIT_SKIP);
        expect(decideExitCode('preview', 'feat/preview/nested')).toBe(EXIT_SKIP);
        expect(decideExitCode('preview', 'my-preview/branch')).toBe(EXIT_SKIP);
    });

    it('missing or unknown environment skips SAFELY — never builds implicitly', () => {
        expect(decideExitCode(undefined, 'preview/1043-mt-wasm')).toBe(EXIT_SKIP);
        expect(decideExitCode('', 'preview/1043-mt-wasm')).toBe(EXIT_SKIP);
        expect(decideExitCode('development', 'preview/1043-mt-wasm')).toBe(EXIT_SKIP);
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
