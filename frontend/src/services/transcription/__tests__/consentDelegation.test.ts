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

    it('CASUALTY: a facade that cannot record consent THROWS rather than logging and continuing', () => {
        // Returning void is not failing closed. Logging and continuing let TranscriptionService proceed
        // to initialise the model as though consent had been saved: the download ran, nothing was
        // persisted, and the next session asked again — every step reporting success while the user was
        // stuck in a loop.
        const whisper = src(WHISPER);
        const at = whisper.indexOf('public grantModelConsent(');
        const method = whisper.slice(at, at + 1600);
        expect(method).toMatch(/logger\.error/);
        expect(method, 'a missing recorder must stop initialization, not be noted in a log')
            .toMatch(/throw new Error\('STT_CONSENT_AUTHORITY_MISSING/);
    });

    it('CASUALTY: the SERVICE refuses to initialize when the strategy has no consent recorder', () => {
        // `strategy.grantModelConsent?.()` no-ops when the method is absent entirely, so a strategy
        // without a recorder proceeded to model initialization as though the decision had been saved.
        // The wrapper's throw cannot help there — the call never reaches it.
        const service = src(SERVICE);
        const at = service.indexOf("if (availability.reason === 'CONSENT_REQUIRED')");
        const block = service.slice(at, at + 1600);
        expect(block).toMatch(/typeof strategy\.grantModelConsent !== 'function'/);
        expect(block).toMatch(/STT_CONSENT_AUTHORITY_MISSING/);
        expect(block, 'the refusal must be thrown, not logged').toMatch(/throw error/);
        // The call itself is unconditional now; the guard above decides. Asserted on the CALL rather
        // than by grepping for the old optional form, which also appears in the comment explaining it.
        expect(block, 'the grant must be called unconditionally once the guard has passed')
            .toMatch(/\n\s*strategy\.grantModelConsent\(\);/);
    });

    it('the engine still owns the receipt', () => {
        expect(src(ENGINE)).toMatch(/public grantModelConsent\(\): void/);
    });

    it('the service still asks at the consent gate', () => {
        expect(src(SERVICE)).toMatch(/grantModelConsent/);
    });
});

describe('the caller signals finality, because the engine cannot infer it', () => {
    it('CASUALTY: processAudio passes its `force` through as `final`', () => {
        // The engine sees a Float32Array either way. `processAudio({ force: true })` is the stop-commit
        // and every other call is a live window, so the caller is the only place that knows. Dropping
        // this argument turns the commit into a live window: nothing finalizes, and the take is decoded
        // by a fresh stream again.
        //
        // Asserted here because no test drives `processAudio` itself — mutation showed that removing the
        // argument failed nothing at all, which is the gap this closes.
        const whisper = src(WHISPER);
        expect(whisper, 'the live/commit decode must carry finality')
            .toMatch(/privateSTT\.transcribe\(processedAudio,\s*\{\s*final:\s*force\s*\}\)/);
    });

    it('CASUALTY: the wrapper forwards options rather than dropping them', () => {
        const whisper = src(WHISPER);
        const at = whisper.indexOf('async transcribe(audio: Float32Array');
        const method = whisper.slice(at, at + 260);
        expect(method).toMatch(/options\?:\s*\{\s*final\?:\s*boolean\s*\}/);
        expect(method, 'options dropped here would strand the finality signal')
            .toMatch(/this\.privateSTT\.transcribe\(audio,\s*options\)/);
    });

    it('the facade forwards options to the engine', () => {
        expect(src(ENGINE)).toMatch(/this\.engine\.transcribe\(audio,\s*options\)/);
    });
});
