import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useTranscriptState } from '../useTranscriptState';

describe('useTranscriptState', () => {
    it('should initialize with empty state', () => {
        const { result } = renderHook(() => useTranscriptState());
        expect(result.current.finalChunks).toEqual([]);
        expect(result.current.interimTranscript).toBe('');
        expect(result.current.transcript).toBe('');
    });

    it('should add a chunk and update the transcript', () => {
        const { result } = renderHook(() => useTranscriptState());
        act(() => {
            result.current.addChunk('Hello');
        });
        expect(result.current.finalChunks[0]).toEqual(expect.objectContaining({ text: 'Hello' }));
        expect(result.current.transcript).toBe('Hello');
    });

    it('should set the interim transcript', () => {
        const { result } = renderHook(() => useTranscriptState());
        act(() => {
            result.current.setInterimTranscript('world');
        });
        expect(result.current.interimTranscript).toBe('world');
    });

    it('should reset the state', () => {
        const { result } = renderHook(() => useTranscriptState());
        act(() => {
            result.current.addChunk('Hello');
            result.current.setInterimTranscript('world');
        });
        act(() => {
            result.current.reset();
        });
        expect(result.current.finalChunks).toEqual([]);
        expect(result.current.interimTranscript).toBe('');
        expect(result.current.transcript).toBe('');
    });
});