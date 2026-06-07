import { describe, expect, it } from 'vitest';
import { resolveAppMode, resolveAppModeMeta } from '../../../../scripts/build.config.js';
import { computeAppRuntimeConfig, type AppModeMeta } from '../appRuntimeConfig';

/**
 * Priority-10 release-hygiene guard: production must NOT report viteMode 'development'.
 *
 * `resolveAppMode` reuses the `manual` entry (viteMode: 'development') for every non-test mode,
 * including a `--mode production` build. `resolveAppModeMeta` (used by vite.config define) must
 * report the ACTUAL vite mode while preserving manual's auth/port/eligibility semantics.
 */
describe('resolveAppModeMeta — truthful viteMode label (no prod dev-diagnostic leak)', () => {
    it('a production build reports viteMode "production", NEVER "development"', () => {
        const meta = resolveAppModeMeta('production');
        expect(meta.viteMode).toBe('production');
        expect(meta.viteMode).not.toBe('development');
        // Auth/port/eligibility semantics are unchanged from the manual mapping.
        expect(meta.authMode).toBe('real');
        expect(meta.port).toBe(resolveAppMode('production').port);
        expect(meta.releaseProofEligible).toBe(true);
    });

    it('dev and test builds keep their real labels + semantics', () => {
        const dev = resolveAppModeMeta('development');
        expect(dev.viteMode).toBe('development');
        expect(dev.authMode).toBe('real');

        const test = resolveAppModeMeta('test');
        expect(test.viteMode).toBe('test');
        expect(test.authMode).toBe('mock');
        expect(test.releaseProofEligible).toBe(false);
    });

    it('only the viteMode label differs from resolveAppMode; auth/port/eligibility are identical', () => {
        for (const mode of ['production', 'development', 'preview', 'test']) {
            const base = resolveAppMode(mode);
            const meta = resolveAppModeMeta(mode);
            expect(meta.authMode).toBe(base.authMode);
            expect(meta.port).toBe(base.port);
            expect(meta.releaseProofEligible).toBe(base.releaseProofEligible);
            expect(meta.viteMode).toBe(mode);
        }
    });

    it('the published production runtime config is eligible AND not labeled development', () => {
        const meta = resolveAppModeMeta('production') as AppModeMeta;
        const cfg = computeAppRuntimeConfig({
            meta,
            supabaseUrl: 'https://abcd.supabase.co',
            envAuthMode: 'real',
            useMockAuthEnv: false,
            actualPort: meta.port,
            url: 'https://speaksharp-public.vercel.app/session',
        });
        expect(cfg.viteMode).toBe('production');
        expect(cfg.viteMode).not.toBe('development');
        expect(cfg.releaseProofEligible).toBe(true);
        expect(cfg.mockAuth).toBe(false);
    });
});
