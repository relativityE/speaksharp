import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { FILLER_WORD_KEYS } from '../config';

// Mock the global SpeechRecognition API
const mockRecognition = {
  start: vi.fn(),
  stop: vi.fn(),
  abort: vi.fn(),
  continuous: false,
  interimResults: false,
  lang: '',
};
global.SpeechRecognition = vi.fn(() => mockRecognition);
global.webkitSpeechRecognition = vi.fn(() => mockRecognition);

describe('useSpeechRecognition Hook', () => {
    it('should correctly count filler words from a transcript chunk', () => {
        const { result } = renderHook(() => useSpeechRecognition());

        const mockEvent = {
            resultIndex: 0,
            results: [
                {
                    0: { transcript: 'um like you know this is a test and uh so I Mean ah' },
                    isFinal: true,
                }
            ]
        };

        act(() => {
            result.current.processTranscript(mockEvent);
        });

        const { fillerData } = result.current;

        expect(fillerData[FILLER_WORD_KEYS.UM].count).toBe(1);
        expect(fillerData[FILLER_WORD_KEYS.LIKE].count).toBe(1);
        expect(fillerData[FILLER_WORD_KEYS.YOU_KNOW].count).toBe(1);
        expect(fillerData[FILLER_WORD_KEYS.UH].count).toBe(1);
        expect(fillerData[FILLER_WORD_KEYS.SO].count).toBe(1);
        expect(fillerData[FILLER_WORD_KEYS.I_MEAN].count).toBe(1);
        expect(fillerData[FILLER_WORD_KEYS.AH].count).toBe(1);
        expect(fillerData[FILLER_WORD_KEYS.ACTUALLY].count).toBe(0);
    });
});
