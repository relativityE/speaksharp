import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { pathNeedsRuntimeAtBoot, startRuntimeIfPathNeedsIt, RUNTIME_BOOT_ROUTES } from '../runtimeBootGate';

/*
 * The casualty this gate exists for: a tab left open on a page nobody records on used to cycle
 * `IDLE`→`TERMINATED`→`IDLE` every five minutes, because booting the runtime arms the
 * idle-reclamation timer and reclamation re-arms it. Battery on the user's device, and lifecycle
 * telemetry attributed to a user who did nothing.
 */
describe('runtime boot gate — only the routes that use the runtime may boot it', () => {
    it('declines the routes an idle tab actually sits on', () => {
        for (const path of ['/', '/terms', '/privacy', '/pricing', '/auth/signin', '/auth/signup', '/auth/reset', '/auth/continue', '/practice', '/admin/ops-status']) {
            expect(pathNeedsRuntimeAtBoot(path), `${path} must not boot the runtime`).toBe(false);
        }
    });

    it('boots for the routes that mount TranscriptionProvider', () => {
        for (const path of ['/session', '/analytics', '/analytics/abc-123']) {
            expect(pathNeedsRuntimeAtBoot(path), `${path} must boot the runtime`).toBe(true);
        }
    });

    it('matches on a segment boundary, so a neighbouring path is not swept in', () => {
        expect(pathNeedsRuntimeAtBoot('/sessions-archive')).toBe(false);
        expect(pathNeedsRuntimeAtBoot('/session-notes')).toBe(false);
        expect(pathNeedsRuntimeAtBoot('/analytics-export')).toBe(false);
    });

    it('normalises what a real boot passes: trailing slash, case, query and hash', () => {
        expect(pathNeedsRuntimeAtBoot('/session/')).toBe(true);
        expect(pathNeedsRuntimeAtBoot('/Session')).toBe(true);   // routes are not caseSensitive in App.tsx
        expect(pathNeedsRuntimeAtBoot('/session?from=email')).toBe(true);
        expect(pathNeedsRuntimeAtBoot('/session#top')).toBe(true);
        expect(pathNeedsRuntimeAtBoot('/Terms/')).toBe(false);
        expect(pathNeedsRuntimeAtBoot('')).toBe(false);
        expect(pathNeedsRuntimeAtBoot(null)).toBe(false);
        expect(pathNeedsRuntimeAtBoot(undefined)).toBe(false);
    });

    it('CASUALTY: the boot call is made for a runtime route and NOT made otherwise', () => {
        const start = vi.fn();

        expect(startRuntimeIfPathNeedsIt('/', start)).toBe(false);
        expect(startRuntimeIfPathNeedsIt('/auth/signin', start)).toBe(false);
        expect(start, 'a landing/auth boot must not start the runtime').not.toHaveBeenCalled();

        expect(startRuntimeIfPathNeedsIt('/session', start)).toBe(true);
        expect(start).toHaveBeenCalledTimes(1);

        expect(startRuntimeIfPathNeedsIt('/analytics/xyz', start)).toBe(true);
        expect(start).toHaveBeenCalledTimes(2);
    });

    it('CONTRACT: every route that mounts TranscriptionProvider is covered, and none is covered needlessly', () => {
        // Read the router itself rather than restating it. If a new route is wrapped in
        // TranscriptionProvider, it uses the runtime and must be gated in; if a prefix here stops
        // having a provider, it is a boot cost nobody needs. Either drift fails HERE, next to the
        // list, instead of in production telemetry.
        const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
        const routeChunks = app.split('<Route ').slice(1);
        const runtimeRoutePaths = routeChunks
            .filter((chunk) => chunk.includes('<TranscriptionProvider>'))
            .map((chunk) => /path="([^"]+)"/.exec(chunk)?.[1])
            .filter((path): path is string => Boolean(path));

        expect(runtimeRoutePaths.length, 'App.tsx must still wrap some route in TranscriptionProvider').toBeGreaterThan(0);

        for (const routePath of runtimeRoutePaths) {
            // A concrete URL for the pattern: '/analytics/:sessionId' -> '/analytics/session-1'.
            const concrete = routePath.replace(/:[A-Za-z0-9_]+/g, 'session-1');
            expect(pathNeedsRuntimeAtBoot(concrete), `${routePath} mounts TranscriptionProvider, so it must boot the runtime`).toBe(true);
        }

        for (const gated of RUNTIME_BOOT_ROUTES) {
            expect(
                runtimeRoutePaths.some((routePath) => routePath === gated || routePath.startsWith(`${gated}/`)),
                `${gated} is gated in but no route under it mounts TranscriptionProvider any more`,
            ).toBe(true);
        }
    });

    it('CONTRACT: main.tsx has no ungated runtime boot left', () => {
        // The bug WAS the wiring, not the predicate: `initSTT()` called unconditionally on every
        // route. Both boot paths (test mode and production) must go through the gate.
        const main = readFileSync(resolve(__dirname, '../../main.tsx'), 'utf8');
        const bareCalls = main.match(/^\s*initSTT\(\);/gm) ?? [];
        expect(bareCalls, 'initSTT() must only be invoked through startRuntimeIfPathNeedsIt').toEqual([]);
        // Two call sites: the E2E/test-mode boot and the production boot. Test mode is gated the
        // same way deliberately — a test-only divergence here would mean the browser tier never
        // exercises the gate that production runs.
        expect(main.match(/startRuntimeIfPathNeedsIt\(window\.location\.pathname, initSTT\)/g)?.length,
            'both boot paths must be gated').toBe(2);
    });
});
