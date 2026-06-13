// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import {
    sanitizeDecodeOptions,
    readPrivateDecodeOptionsOverride,
    ALLOWED_DECODE_OPTIONS,
} from '../whisperDecodeOptions';

const setHook = (value: unknown) => {
    (window as unknown as { __PRIVATE_STT_DECODE_OPTIONS__?: unknown }).__PRIVATE_STT_DECODE_OPTIONS__ = value;
};
const clearHook = () => {
    delete (window as unknown as { __PRIVATE_STT_DECODE_OPTIONS__?: unknown }).__PRIVATE_STT_DECODE_OPTIONS__;
};

describe('whisperDecodeOptions (v4 decode-option proof hook, BL-1)', () => {
    describe('sanitizeDecodeOptions', () => {
        it('returns undefined for non-objects', () => {
            expect(sanitizeDecodeOptions(undefined)).toBeUndefined();
            expect(sanitizeDecodeOptions(null)).toBeUndefined();
            expect(sanitizeDecodeOptions('condition_on_previous_text')).toBeUndefined();
            expect(sanitizeDecodeOptions(5)).toBeUndefined();
        });

        it('returns undefined when no allow-listed keys are present (product defaults preserved)', () => {
            expect(sanitizeDecodeOptions({})).toBeUndefined();
            expect(sanitizeDecodeOptions({ not_a_real_option: true, foo: 1 })).toBeUndefined();
        });

        it('keeps allow-listed boolean / number / number[] values', () => {
            expect(sanitizeDecodeOptions({
                condition_on_previous_text: false,
                no_repeat_ngram_size: 3,
                compression_ratio_threshold: 2.4,
                temperature: [0, 0.2, 0.4],
            })).toEqual({
                condition_on_previous_text: false,
                no_repeat_ngram_size: 3,
                compression_ratio_threshold: 2.4,
                temperature: [0, 0.2, 0.4],
            });
        });

        it('drops disallowed keys but keeps allowed ones in the same object (no arbitrary injection)', () => {
            expect(sanitizeDecodeOptions({ no_speech_threshold: 0.6, arbitrary_injection: 'rm -rf', model: 'evil' }))
                .toEqual({ no_speech_threshold: 0.6 });
        });

        it('drops allow-listed keys whose value type is invalid', () => {
            expect(sanitizeDecodeOptions({ condition_on_previous_text: 'false', temperature: ['x'] }))
                .toBeUndefined();
        });

        it('exposes exactly the documented anti-loop knob set', () => {
            expect([...ALLOWED_DECODE_OPTIONS].sort()).toEqual([
                'compression_ratio_threshold',
                'condition_on_previous_text',
                'logprob_threshold',
                'no_repeat_ngram_size',
                'no_speech_threshold',
                'return_timestamps',
                'temperature',
            ]);
        });
    });

    describe('readPrivateDecodeOptionsOverride', () => {
        afterEach(clearHook);

        it('returns undefined when the hook is unset (product defaults preserved)', () => {
            clearHook();
            expect(readPrivateDecodeOptionsOverride()).toBeUndefined();
        });

        it('returns the sanitized override when the hook is set', () => {
            setHook({ condition_on_previous_text: false, no_repeat_ngram_size: 3, bogus: 'ignored' });
            expect(readPrivateDecodeOptionsOverride()).toEqual({
                condition_on_previous_text: false,
                no_repeat_ngram_size: 3,
            });
        });

        it('returns undefined when the hook holds only disallowed keys', () => {
            setHook({ injected: true });
            expect(readPrivateDecodeOptionsOverride()).toBeUndefined();
        });
    });
});
