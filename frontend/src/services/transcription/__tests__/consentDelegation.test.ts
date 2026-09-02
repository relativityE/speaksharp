/**
 * #1402 forward-fix — the consent grant reached an object that could not record it.
 *
 * `TranscriptionService` records consent with `strategy.grantModelConsent?.()`. `strategy` is the mode
 * wrapper (`PrivateWhisper`); the method lives on the engine (`PrivateSTT`). The optional call resolved
 * to `undefined` and did nothing, so the receipt was never written and Moonshine asked for consent again
 * on every attempt: the user granted it, the download began, and the next session asked once more.
 *
 * Exactly the `destroy?.()` shape from the engine work — an optional call to a method that does not
 * exist on the object at hand, succeeding silently.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = (() => {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 12; i++) {
        if (existsSync(join(dir, 'pnpm-lock.yaml'))) return dir;
        dir = dirname(dir);
    }
    throw new Error('repo root not found');
})();
const src = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

const WHISPER = 'frontend/src/services/transcription/modes/PrivateWhisper.ts';
const ENGINE = 'frontend/src/services/transcription/engines/PrivateSTT.ts';
const SERVICE = 'frontend/src/services/transcription/TranscriptionService.ts';

describe('the object the service calls can actually record consent', () => {
    it('CASUALTY: the mode wrapper exposes grantModelConsent', () => {
        // Without this the service's optional call is a no-op and the user is asked forever.
        expect(src(WHISPER), 'PrivateWhisper must expose grantModelConsent').toMatch(/grantModelConsent\s*\(/);
    });

    it('CASUALTY: the wrapper DELEGATES rather than reimplementing the decision', () => {
        // Two places deciding what consent means is how they drift apart; the engine owns the receipt.
        const whisper = src(WHISPER);
        const method = whisper.slice(whisper.indexOf('public grantModelConsent('));
        expect(method.slice(0, 900)).toMatch(/privateSTT/);
    });

    it('CASUALTY: a facade that cannot record consent is logged, not silently ignored', () => {
        const whisper = src(WHISPER);
        const method = whisper.slice(whisper.indexOf('public grantModelConsent('), whisper.indexOf('public grantModelConsent(') + 900);
        expect(method).toMatch(/logger\.error/);
    });

    it('the engine still owns the receipt', () => {
        expect(src(ENGINE)).toMatch(/public grantModelConsent\(\): void/);
    });

    it('the service still asks at the consent gate', () => {
        expect(src(SERVICE)).toMatch(/grantModelConsent/);
    });
});
