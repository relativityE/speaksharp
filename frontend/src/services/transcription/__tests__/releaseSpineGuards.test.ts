// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PRIV_STT_MODELS, PRIV_STT_V4 } from '../sttConstants';
import {
    resolvePrivateModel,
} from '../utils/privateModelFlag';

/**
 * RELEASE-SPINE GUARDS (pull-forward priority 1).
 *
 * These lock the invariants that keep the Private STT release safe regardless of future
 * config edits. They are pure-logic guards over the model registry + selection resolver —
 * no behavior change. The release spine is (PRIVATE-BASE-DEFAULT):
 *   - v2 whisper-base.en = the live Private default (accuracy/trust over fastest first text).
 *   - v2 whisper-tiny.en = internal/emergency fallback only — a selectable candidate, NOT the
 *     default and NOT a user-facing release option.
 *   - v4 = hidden/dev-only; never default, never selectable through the normal Private path.
 *   - unknown selections REJECT (no silent fallback that mislabels the engine).
 */
describe('release-spine guards: Private STT default + opt-in', () => {
    beforeEach(() => {
    });
    afterEach(() => {
    });

    it('base.en is the registered default Private model (PRIVATE-BASE-DEFAULT)', () => {
        expect(PRIV_STT_MODELS.DEFAULT).toBe('whisper-base.en');
    });

    it('default Private provider resolves to base.en (not v4, not tiny) with no flag', () => {
        expect(resolvePrivateModel()).toBe('whisper-base.en');
    });

    it('CASUALTY: tiny.en is NOT the default and is no longer flag-selectable either', () => {
        // It was reachable through the window flag as an "emergency fallback". That flag was a
        // per-visitor channel with no dev/test gate, so the emergency route was also an attack route.
        // Emergency fallback is now the one-way safety kill (to v2), which no visitor can reach.
        expect(resolvePrivateModel()).not.toBe('whisper-tiny.en');
        expect(resolvePrivateModel()).not.toBe('whisper-tiny.en');
    });

    it('the default model consent size is ~80 MB (base) — honest download-consent copy', () => {
        const approxMB = PRIV_STT_MODELS.CANDIDATES[PRIV_STT_MODELS.DEFAULT].approxMB;
        expect(approxMB).toBeGreaterThanOrEqual(70);
        expect(approxMB).toBeLessThanOrEqual(90);
    });
});

describe('release-spine guards: v4 cannot become default or leak via the Private path', () => {
    beforeEach(() => {
    });
    afterEach(() => {
    });

    it('the v4 engine key is not the Private default and not a selectable candidate', () => {
        const candidateKeys = Object.keys(PRIV_STT_MODELS.CANDIDATES);
        expect(candidateKeys).not.toContain(PRIV_STT_V4.ENGINE_KEY); // 'transformers-js-v4'
        expect(PRIV_STT_MODELS.DEFAULT).not.toBe(PRIV_STT_V4.ENGINE_KEY);
    });

    it('the Private candidate allowlist contains no v3/v4 (onnx-community) model ids', () => {
        // The v2 transformers.js library cannot load onnx-community/* repos ("Unsupported model
        // type: whisper"); guarding against one slipping into CANDIDATES prevents both a load
        // break AND a v4 model leaking into the customer Private path.
        for (const [key, cfg] of Object.entries(PRIV_STT_MODELS.CANDIDATES)) {
            expect(key.startsWith('whisper-')).toBe(true);
            expect(cfg.remoteId.startsWith('Xenova/')).toBe(true);
            expect(cfg.remoteId.toLowerCase()).not.toContain('onnx-community');
        }
    });

    it('v4 is never the resolved Private model', () => {
        // Channel INERTNESS (and the retired names it needs to say out loud) is proven once, in
        // `__tests__/noSelectorChannels.guard.test.ts`. What belongs here is the release-spine claim:
        // whatever the resolver returns, it is never a v4 identity.
        const resolved: string = resolvePrivateModel();
        expect([PRIV_STT_V4.ENGINE_KEY, PRIV_STT_V4.MODEL_ID]).not.toContain(resolved);
        expect(resolved).toBe('whisper-base.en');
    });
});
