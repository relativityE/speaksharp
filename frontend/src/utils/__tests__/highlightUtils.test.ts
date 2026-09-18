import { describe, it, expect } from 'vitest';
import { parseTranscriptForHighlighting, getWordColor, fillerHighlightBackground } from '../highlightUtils';

describe('highlightUtils', () => {
    describe('getWordColor', () => {
        it('should return a deterministic color for a given word', () => {
            const color1 = getWordColor('test');
            const color2 = getWordColor('test');
            const color3 = getWordColor('other');

            expect(color1).toBe(color2);
            expect(color1).not.toBe(color3);
        });
    });

    describe('parseTranscriptForHighlighting', () => {
        it('should handle empty text', () => {
            expect(parseTranscriptForHighlighting('')).toEqual([]);
        });

        it('should detect standard filler words', () => {
            const text = 'Um, I think so.';
            const tokens = parseTranscriptForHighlighting(text);

            const umToken = tokens.find(t => t.transcript.toLowerCase() === 'um');
            expect(umToken).toBeDefined();
            expect(umToken?.type).toBe('filler');
        });

        it('should detect multi-word filler phrases (priority matching)', () => {
            // "You know" is a multi-word filler.
            // We want to ensure it matches the whole phrase, not just "you".
            const text = 'I am, you know, practicing.';
            const tokens = parseTranscriptForHighlighting(text, ['you know']);

            const phraseToken = tokens.find(t => t.transcript.toLowerCase() === 'you know');
            expect(phraseToken).toBeDefined();
            expect(phraseToken?.type).toBe('filler');

            // Should not have separate "you" and "know" tokens tagged as filler if phrase matched
            const youToken = tokens.find(t => t.transcript.toLowerCase() === 'you');
            expect(youToken?.type).not.toBe('filler');
        });

        it('should detect error tags', () => {
            const text = 'Hello [BLANK_AUDIO] world.';
            const tokens = parseTranscriptForHighlighting(text);

            const errorToken = tokens.find(t => t.type === 'error');
            expect(errorToken).toBeDefined();
            expect(errorToken?.transcript).toBe('[BLANK_AUDIO]');
        });

        it('should detect user words', () => {
            const text = 'Welcome to SpeakSharp.';
            const tokens = parseTranscriptForHighlighting(text, ['SpeakSharp']);

            const userToken = tokens.find(t => t.transcript === 'SpeakSharp');
            expect(userToken).toBeDefined();
            expect(userToken?.type).toBe('filler'); // User words are tagged as filler for highlighting
        });
    });
});


/**
 * #1487 P2 casualty — the filler highlight's translucent wash.
 *
 * The palette is `var(--brand-filler-series-*)` now, and the old caller built its background by
 * appending a hex alpha to that string. `var(--brand-filler-series-1)15` is not a colour: the browser
 * throws the declaration away without an error, the wash vanishes, and nothing in the type system or a
 * render assertion notices, because an invalid colour is still a perfectly good string.
 *
 * These assert the composed value directly, so they hold regardless of whether the test environment's
 * CSS parser understands `color-mix` — jsdom does not have to accept the value for the contract to be
 * provable.
 */
describe('fillerHighlightBackground (#1487 P2)', () => {
    it('composes alpha with color-mix so a CSS variable survives', () => {
        expect(fillerHighlightBackground('var(--brand-filler-series-1)'))
            .toBe('color-mix(in srgb, var(--brand-filler-series-1) 8%, transparent)');
    });

    it('CASUALTY: never concatenates an alpha suffix onto the colour', () => {
        for (const color of ['var(--brand-filler-series-1)', 'var(--brand-filler-series-12)', 'currentColor']) {
            const background = fillerHighlightBackground(color);
            // The exact shape of the old bug: the colour followed immediately by hex digits.
            expect(background, `alpha must not be concatenated onto ${color}`).not.toMatch(/\)\s*[0-9a-fA-F]{2}/);
            expect(background).not.toBe(`${color}15`);
            expect(background).toContain(color);
        }
    });

    it('every palette entry produces a background that still references its variable', () => {
        const seen = new Set<string>();
        for (const word of ['um', 'uh', 'like', 'so', 'actually', 'basically', 'you know', 'right']) {
            const color = getWordColor(word);
            expect(color, 'the palette is variable-based').toMatch(/^var\(--brand-filler-series-\d+\)$/);
            const background = fillerHighlightBackground(color);
            expect(background).toContain(color);
            expect(background.startsWith('color-mix(')).toBe(true);
            seen.add(color);
        }
        expect(seen.size, 'distinct words take distinct series slots').toBeGreaterThan(1);
    });
});
