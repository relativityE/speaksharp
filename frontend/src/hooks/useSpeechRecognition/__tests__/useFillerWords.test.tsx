import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useFillerWords } from '../useFillerWords';
import { Chunk } from '../types';

describe('useFillerWords', () => {
  const customWords: string[] = [];

  it('should initialize with zero counts', () => {
    const { result } = renderHook(() => useFillerWords([], '', customWords));
    expect(result.current.totalCount).toBe(0);
  });

  it('should count filler words in final chunks', () => {
    const chunks: Chunk[] = [
      { text: 'Um, hello.', id: 1, timestamp: Date.now() },
      { text: 'Like, you know.', id: 2, timestamp: Date.now() }
    ];
    const { result } = renderHook(() => useFillerWords(chunks, '', customWords));

    // countFillerWords should find: Um, Like, you know
    // Depending on fillerWordUtils.ts implementation.
    // FILLER_WORD_KEYS.UM, FILLER_WORD_KEYS.LIKE, FILLER_WORD_KEYS.YOU_KNOW
    expect(result.current.totalCount).toBeGreaterThan(0);
  });

  it('should handle interim transcript transiently', () => {
    const chunks: Chunk[] = [];
    const { result, rerender } = renderHook(
      ({ chunks, interim }) => useFillerWords(chunks, interim, customWords),
      { initialProps: { chunks, interim: '' } }
    );

    expect(result.current.totalCount).toBe(0);

    rerender({ chunks, interim: 'um' });
    expect(result.current.totalCount).toBe(1);

    rerender({ chunks, interim: 'um ah' });
    expect(result.current.totalCount).toBe(2);

    // When interim is cleared (became final)
    const newChunks: Chunk[] = [{ text: 'um ah', id: 3, timestamp: Date.now() }];
    rerender({ chunks: newChunks, interim: '' });
    expect(result.current.totalCount).toBe(2);
  });

  it('should reset when chunks are cleared', () => {
    const chunks: Chunk[] = [{ text: 'um', id: 1, timestamp: Date.now() }];
    const { result, rerender } = renderHook(
      ({ chunks }) => useFillerWords(chunks, '', customWords),
      { initialProps: { chunks } }
    );

    expect(result.current.totalCount).toBe(1);

    rerender({ chunks: [] });
    expect(result.current.totalCount).toBe(0);
  });
});
