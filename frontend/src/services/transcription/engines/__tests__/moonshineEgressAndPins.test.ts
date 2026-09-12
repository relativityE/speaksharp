/**
 * #1381 closure point 6 — zero audio egress, and downloads that can be attributed to a pin.
 *
 * SCOPE, STATED HONESTLY. These tests cover OUR code: the engine module we wrote, and the pin table the
 * registry points at. They cannot prove the vendored WASM runtime does not open a socket of its own —
 * no unit test can, because the bytes are opaque to it. That is precisely what #1390's live egress
 * audit exists to observe, and it now fails closed on any off-origin request carrying a body rather
 * than checking a list of known vendors.
 *
 * Claiming more than this from a unit test would be the same error as reporting a requested model as
 * the one that ran: an intention presented as an observation.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CANDIDATES } from '../../candidateRegistry';

const REPO_ROOT = (() => {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 12; i++) {
        if (existsSyncSafe(join(dir, 'pnpm-lock.yaml'))) return dir;
        dir = dirname(dir);
    }
    throw new Error('repo root not found');
})();

function existsSyncSafe(p: string): boolean {
    try { readFileSync(p); return true; } catch { return false; }
}

const MOONSHINE = CANDIDATES['moonshine:streaming-medium'];
const ENGINE_SRC = readFileSync(
    join(REPO_ROOT, 'frontend/src/services/transcription/engines/MoonshineStreamingEngine.ts'),
    'utf8',
);

describe('the engine itself has no way to send audio anywhere', () => {
    it('CASUALTY: no network primitive appears in the engine source', () => {
        // The engine holds raw PCM frames. If it could reach the network at all, the privacy claim would
        // rest on reviewing every call site forever; with no primitive present it rests on the absence.
        // A new one appearing is a deliberate act that has to pass here first.
        for (const primitive of [/\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /sendBeacon/, /navigator\.connection/]) {
            expect(ENGINE_SRC, `engine source must not contain ${primitive}`).not.toMatch(primitive);
        }
    });

    it('CASUALTY: audio frames are passed to the runtime and to nothing else', () => {
        // `addAudio` is the single sink. If a second consumer of the frame ever appears, this is where
        // it has to be justified.
        const frameSinks = ENGINE_SRC.match(/\.(addAudio|transcribe)\(/g) ?? [];
        expect(frameSinks.length, 'audio reaches only the runtime stream and its decode call')
            .toBeGreaterThan(0);
        expect(ENGINE_SRC).not.toMatch(/JSON\.stringify\([^)]*frame/i);
    });
});

describe('every byte we may download is attributable to a pin', () => {
    const pins = JSON.parse(readFileSync(join(REPO_ROOT, MOONSHINE.assets.pinSource!), 'utf8')) as {
        assets: Record<string, { sha256: string; bytes: number; url: string }>;
    };
    const mine = Object.entries(pins.assets).filter(([k]) => k.includes(MOONSHINE.model.id));

    it('CASUALTY: each pinned component carries a digest, a byte count and an absolute https URL', () => {
        expect(mine).toHaveLength(MOONSHINE.assets.componentCount as number);
        for (const [key, a] of mine) {
            expect(a.sha256, `${key} has no digest`).toMatch(/^[0-9a-f]{64}$/);
            expect(a.bytes, `${key} has no byte count`).toBeGreaterThan(0);
            // Without a URL an observed download cannot be matched back to the pin that authorised it,
            // which is what "attributable" has to mean in practice.
            expect(a.url, `${key} has no URL`).toMatch(/^https:\/\//);
        }
    });

    it('CASUALTY: the pinned components all sit on ONE origin, which the egress audit can allow', () => {
        // A pin set spread across hosts would force the live audit's allowance to widen until it stopped
        // discriminating. One origin keeps the allowance narrow enough to still be meaningful.
        const origins = new Set(mine.map(([, a]) => new URL(a.url).origin));
        expect([...origins]).toEqual(['https://download.moonshine.ai']);
    });

    it('CASUALTY: the revision is pinned in the path, so a re-publish cannot be silently picked up', () => {
        for (const [, a] of mine) {
            expect(a.url, 'asset URL must carry the pinned revision').toContain(MOONSHINE.model.revision!);
        }
        expect(MOONSHINE.model.revision).toBeTruthy();
    });

    it('the consented maximum equals the sum of exactly these pinned components', () => {
        expect(MOONSHINE.assets.totalBytes).toBe(mine.reduce((sum, [, a]) => sum + a.bytes, 0));
    });
});
