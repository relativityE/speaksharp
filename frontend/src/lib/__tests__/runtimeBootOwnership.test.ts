import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * WHO MAY BOOT THE SPEECH RUNTIME (#1517, option A accepted by PM/PO).
 *
 * The casualty: booting the runtime arms the 5-minute idle-reclamation timer, and reclamation re-arms it, so a tab
 * left open where nobody records cycles `IDLE`→`TERMINATED`→`IDLE` forever — battery on the user's device and
 * lifecycle telemetry attributed to a user who did nothing.
 *
 * A path-based boot gate in `main.tsx` could not close this: it runs before React knows who the user is, so a
 * signed-out deep link to `/session` booted the runtime and `ProtectedRoute` then redirected to `/auth`, leaving the
 * timer cycling on the sign-in tab (Codex P2 on 4746c00d). The runtime is therefore owned by ONE initializer —
 * `TranscriptionProvider`, which mounts only inside an admitted `ProtectedRoute`.
 */
const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

describe('#1517 — only an admitted runtime page boots the speech runtime', () => {
    // FORBID THE CALL, PERMIT THE MENTION: the comment explaining why main.tsx no longer boots the runtime names the
    // initializer, and a substring guard would teach the next reader to delete the explanation instead of the call.
    const INIT_CALL = /\.initializeInfrastructure\s*\(/;
    const CONTROLLER_LOAD = /(import\s*\(\s*|from\s+)['"][^'"]*\/services\/SpeechRuntimeController['"]/;

    it('CASUALTY (Codex P2 on 4746c00d): main.tsx never initializes the runtime, on either boot path', () => {
        const main = read('../../main.tsx');
        expect(main, 'no boot-time initializer call').not.toMatch(INIT_CALL);
        expect(main, 'main.tsx does not load the runtime controller at all').not.toMatch(CONTROLLER_LOAD);
    });

    it('the call/mention distinction holds in both directions', () => {
        expect(INIT_CALL.test('speechRuntimeController.initializeInfrastructure()')).toBe(true);
        expect(CONTROLLER_LOAD.test("void import('./services/SpeechRuntimeController').then(() => {})")).toBe(true);
        expect(CONTROLLER_LOAD.test("import { x } from './services/SpeechRuntimeController';")).toBe(true);
        expect(INIT_CALL.test(' * It used to call `initializeInfrastructure()` on every route')).toBe(false);
        expect(CONTROLLER_LOAD.test(' * the SpeechRuntimeController is booted by TranscriptionProvider')).toBe(false);
    });

    it('CONTRACT: the one initializer is TranscriptionProvider, and it initializes on mount', () => {
        expect(read('../../providers/TranscriptionProvider.tsx')).toMatch(/speechRuntimeController\.initializeInfrastructure\(\)/);
    });

    it('CONTRACT: every route that mounts TranscriptionProvider mounts it INSIDE ProtectedRoute', () => {
        // Read the router itself rather than restating it: a new provider route outside ProtectedRoute would boot the
        // runtime for a signed-out visitor again, and must fail here, not in production telemetry.
        const app = read('../../App.tsx');
        const providerRoutes = app.split('<Route ').slice(1).filter((chunk) => chunk.includes('<TranscriptionProvider>'));
        expect(providerRoutes.length, 'App.tsx must still wrap some route in TranscriptionProvider').toBeGreaterThan(0);
        for (const chunk of providerRoutes) {
            const path = /path="([^"]+)"/.exec(chunk)?.[1];
            const guard = chunk.indexOf('<ProtectedRoute>');
            expect(guard, `${path}: TranscriptionProvider must sit inside ProtectedRoute`).toBeGreaterThanOrEqual(0);
            expect(guard, `${path}: ProtectedRoute must wrap the provider, not follow it`).toBeLessThan(chunk.indexOf('<TranscriptionProvider>'));
        }
    });

    it('CASUALTY (#1517 P1 on 08f3d0e9): the model-comparison switch still installs on EVERY route, on both boot paths', () => {
        // The comparison tooling enters from `/` and `/practice` and needs `__SS_SWITCH_CANDIDATE__` before it navigates
        // to `/session`; TranscriptionProvider installs nothing. The switch starts no engine and arms no timer.
        const main = read('../../main.tsx');
        const unconditional = main.match(/^\s*installComparisonSwitch\(\);$/gm) ?? [];
        expect(unconditional, 'both boot paths install the switch unconditionally').toHaveLength(2);
    });
});
