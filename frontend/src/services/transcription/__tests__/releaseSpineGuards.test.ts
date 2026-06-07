// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PRIV_STT_MODELS, PRIV_STT_V4 } from '../sttConstants';
import {
    assertValidPrivateModelSelection,
    isPrivateModelOverridden,
    resolvePrivateModel,
    resolvePrivateModelSource,
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
        delete (window as { __PRIVATE_MODEL__?: string }).__PRIVATE_MODEL__;
    });
    afterEach(() => {
        delete (window as { __PRIVATE_MODEL__?: string }).__PRIVATE_MODEL__;
    });

    it('base.en is the registered default Private model (PRIVATE-BASE-DEFAULT)', () => {
        expect(PRIV_STT_MODELS.DEFAULT).toBe('whisper-base.en');
    });

    it('default Private provider resolves to base.en (not v4, not tiny) with no flag', () => {
        expect(resolvePrivateModel()).toBe('whisper-base.en');
        expect(resolvePrivateModelSource()).toBe('default');
        expect(isPrivateModelOverridden()).toBe(false);
    });

    it('tiny.en is an internal/emergency fallback only: NOT the default, but still flag-selectable', () => {
        // Not the default...
        expect(resolvePrivateModel()).not.toBe('whisper-tiny.en');
        // ...but reachable as an explicit internal override (emergency fallback).
        (window as { __PRIVATE_MODEL__?: string }).__PRIVATE_MODEL__ = 'whisper-tiny.en';
        expect(resolvePrivateModel()).toBe('whisper-tiny.en');
        expect(isPrivateModelOverridden()).toBe(true);
        expect(resolvePrivateModelSource()).toBe('window');
    });

    it('the default model consent size is ~80 MB (base) — honest download-consent copy', () => {
        const approxMB = PRIV_STT_MODELS.CANDIDATES[PRIV_STT_MODELS.DEFAULT].approxMB;
        expect(approxMB).toBeGreaterThanOrEqual(70);
        expect(approxMB).toBeLessThanOrEqual(90);
    });
});

describe('release-spine guards: v4 cannot become default or leak via the Private path', () => {
    beforeEach(() => {
        delete (window as { __PRIVATE_MODEL__?: string }).__PRIVATE_MODEL__;
    });
    afterEach(() => {
        delete (window as { __PRIVATE_MODEL__?: string }).__PRIVATE_MODEL__;
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

    it('requesting v4 via the Private flag is NOT silently honored', () => {
        for (const bogus of [PRIV_STT_V4.ENGINE_KEY, PRIV_STT_V4.MODEL_ID, 'onnx-community/whisper-base.en']) {
            (window as { __PRIVATE_MODEL__?: string }).__PRIVATE_MODEL__ = bogus;
            // resolver stays total -> falls back to the safe default rather than honoring v4...
            expect(resolvePrivateModel()).toBe('whisper-base.en');
            // ...and an explicit request for an unsupported id REJECTS (no mislabeled engine).
            expect(() => assertValidPrivateModelSelection()).toThrow(/not supported|MODEL_LOAD_FAILED/);
        }
    });
});

describe('release-spine guards: unknown selections reject, no silent fallback', () => {
    beforeEach(() => {
        delete (window as { __PRIVATE_MODEL__?: string }).__PRIVATE_MODEL__;
    });
    afterEach(() => {
        delete (window as { __PRIVATE_MODEL__?: string }).__PRIVATE_MODEL__;
    });

    it('an unknown model flag throws at session start instead of resolving to a different model', () => {
        (window as { __PRIVATE_MODEL__?: string }).__PRIVATE_MODEL__ = 'whisper-enormous.en';
        expect(() => assertValidPrivateModelSelection()).toThrow();
        // The total resolver still returns the safe default (never a wrong-but-quiet pick).
        expect(resolvePrivateModel()).toBe('whisper-base.en');
    });

    it('no flag and a valid candidate both pass the start-time assertion', () => {
        expect(() => assertValidPrivateModelSelection()).not.toThrow();
        (window as { __PRIVATE_MODEL__?: string }).__PRIVATE_MODEL__ = 'whisper-base.en';
        expect(() => assertValidPrivateModelSelection()).not.toThrow();
    });
});
