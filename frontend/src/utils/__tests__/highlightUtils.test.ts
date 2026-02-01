import { describe, it, expect } from 'vitest';
import { parseTranscriptForHighlighting, getWordColor } from '../highlightUtils';

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

            const umToken = tokens.find(t => t.text.toLowerCase() === 'um');
            expect(umToken).toBeDefined();
            expect(umToken?.type).toBe('filler');
        });

        it('should detect multi-word filler phrases (priority matching)', () => {
            // "You know" is a multi-word filler.
            // We want to ensure it matches the whole phrase, not just "you".
            const text = 'I am, you know, practicing.';
            const tokens = parseTranscriptForHighlighting(text, ['you know']);

            const phraseToken = tokens.find(t => t.text.toLowerCase() === 'you know');
            expect(phraseToken).toBeDefined();
            expect(phraseToken?.type).toBe('filler');

            // Should not have separate "you" and "know" tokens tagged as filler if phrase matched
            const youToken = tokens.find(t => t.text.toLowerCase() === 'you');
            expect(youToken?.type).not.toBe('filler');
        });

        it('should detect error tags', () => {
            const text = 'Hello [BLANK_AUDIO] world.';
            const tokens = parseTranscriptForHighlighting(text);

            const errorToken = tokens.find(t => t.type === 'error');
            expect(errorToken).toBeDefined();
            expect(errorToken?.text).toBe('[BLANK_AUDIO]');
        });

        it('should detect custom words', () => {
            const text = 'Welcome to SpeakSharp.';
            const tokens = parseTranscriptForHighlighting(text, ['SpeakSharp']);

            const customToken = tokens.find(t => t.text === 'SpeakSharp');
            expect(customToken).toBeDefined();
            expect(customToken?.type).toBe('filler'); // Custom words are tagged as filler for highlighting
        });
    });
});
