import { renderHook, act } from '../../../../tests/support/test-utils';
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

  it('should handle interim transcript transiently with debounce', () => {
    vi.useFakeTimers();
    const chunks: Chunk[] = [];
    const { result, rerender } = renderHook(
      ({ chunks, interim }: { chunks: Chunk[], interim: string }) => useFillerWords(chunks, interim, customWords),
      { initialProps: { chunks, interim: '' } }
    );

    expect(result.current.totalCount).toBe(0);

    // 1. Initial interim update
    rerender({ chunks, interim: 'um' });
    // Should still be 0 due to debounce
    expect(result.current.totalCount).toBe(0);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.totalCount).toBe(1);

    // 2. Rapid interim update
    rerender({ chunks, interim: 'um ah' });
    expect(result.current.totalCount).toBe(1); // Still previous value

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.totalCount).toBe(2);

    // 3. Immediate clear when transcript becomes final
    const newChunks: Chunk[] = [{ text: 'um ah', id: 3, timestamp: Date.now() }];
    rerender({ chunks: newChunks, interim: '' });
    // Should be immediate (no debounce for empty string)
    expect(result.current.totalCount).toBe(2);

    vi.useRealTimers();
  });

  it('should reset when chunks are cleared', () => {
    const chunks: Chunk[] = [{ text: 'um', id: 1, timestamp: Date.now() }];
    const { result, rerender } = renderHook(
      ({ chunks }: { chunks: Chunk[] }) => useFillerWords(chunks, '', customWords),
      { initialProps: { chunks } }
    );

    expect(result.current.totalCount).toBe(1);

    rerender({ chunks: [] });
    expect(result.current.totalCount).toBe(0);
  });
});
