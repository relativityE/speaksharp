import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useTranscriptState } from '../useTranscriptState';

// Mock the limitArray utility
vi.mock('../../../utils/fillerWordUtils', () => ({
  limitArray: vi.fn((arr, limit) => arr.slice(0, limit))
}));

describe('useTranscriptState', () => {
  it('should initialize with empty state', () => {
    const { result } = renderHook(() => useTranscriptState());

    expect(result.current.finalChunks).toEqual([]);
    expect(result.current.interimTranscript).toBe('');
    expect(result.current.transcript).toBe('');
  });

  it('should add chunks and update transcript', () => {
    const { result } = renderHook(() => useTranscriptState());

    act(() => {
      result.current.addChunk('Hello');
    });

    expect(result.current.finalChunks).toHaveLength(1);
    expect(result.current.finalChunks[0].text).toBe('Hello');
    expect(result.current.transcript).toBe('Hello');

    act(() => {
      result.current.addChunk('world');
    });

    expect(result.current.finalChunks).toHaveLength(2);
    expect(result.current.transcript).toBe('Hello world');
  });

  it('should update interim transcript', () => {
    const { result } = renderHook(() => useTranscriptState());

    act(() => {
      result.current.setInterimTranscript('typing...');
    });

    expect(result.current.interimTranscript).toBe('typing...');
  });

  it('should reset all state', () => {
    const { result } = renderHook(() => useTranscriptState());

    // Add some data first
    act(() => {
      result.current.addChunk('test');
      result.current.setInterimTranscript('interim');
    });

    // Reset
    act(() => {
      result.current.reset();
    });

    expect(result.current.finalChunks).toEqual([]);
    expect(result.current.interimTranscript).toBe('');
    expect(result.current.transcript).toBe('');
  });
});