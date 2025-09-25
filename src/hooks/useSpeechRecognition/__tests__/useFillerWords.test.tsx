import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useFillerWords } from '../useFillerWords';
import type { Chunk } from '../types';
import * as fillerWordUtils from '../../../utils/fillerWordUtils';

// Mock the filler word utilities
vi.mock('../../../utils/fillerWordUtils');

describe('useFillerWords', () => {
  const mockChunks: Chunk[] = [{ text: 'Hello um world', id: 1 }];
  const customWords = ['like'];

  beforeEach(() => {
    vi.useFakeTimers();
    const mockFillerData = {
      total: { count: 0, color: '' },
      um: { count: 0, color: '' },
      uh: { count: 0, color: '' },
      like: { count: 0, color: '' },
    };
    const mockCounts = {
      total: { count: 2, color: '' },
      um: { count: 1, color: '' },
      uh: { count: 1, color: '' },
      like: { count: 0, color: '' },
    };
    vi.mocked(fillerWordUtils.createInitialFillerData).mockReturnValue(mockFillerData);
    vi.mocked(fillerWordUtils.countFillerWords).mockReturnValue(mockCounts);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('should initialize with initial filler data', () => {
    const { result } = renderHook(() =>
      useFillerWords([], '', customWords)
    );

    expect(fillerWordUtils.createInitialFillerData).toHaveBeenCalledWith(customWords);
    expect(result.current.fillerData).toEqual({ total: 0, um: 0, uh: 0, like: 0 });
    expect(result.current.finalFillerData).toEqual({ total: 0, um: 0, uh: 0, like: 0 });
  });

  it('should update final filler data when chunks change', () => {
    renderHook(() =>
      useFillerWords(mockChunks, '', customWords)
    );

    expect(fillerWordUtils.countFillerWords).toHaveBeenCalledWith('Hello um world', customWords);
  });

  it('should debounce live filler word counting', () => {
    renderHook(() =>
      useFillerWords(mockChunks, 'uh test', customWords)
    );

    // Should not be called immediately
    expect(fillerWordUtils.countFillerWords).toHaveBeenCalledTimes(1); // Only for final data

    // Fast forward the debounce timer
    act(() => {
      vi.advanceTimersByTime(60);
    });

    // Now should be called for live data
    expect(fillerWordUtils.countFillerWords).toHaveBeenCalledWith('Hello um world uh test', customWords);
  });

  it('should reset filler data', () => {
    const { result } = renderHook(() => useFillerWords(mockChunks, '', customWords));
    act(() => {
      result.current.reset();
    });

    expect(fillerWordUtils.createInitialFillerData).toHaveBeenCalledWith(customWords);
  });
});