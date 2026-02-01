import { useState, useCallback, useMemo } from 'react';
import { Chunk } from './types';
import { combineChunksToText, createChunk } from './utils';

const MAX_CHUNKS = 1000;

export const useTranscriptState = () => {
  const [finalChunks, setFinalChunks] = useState<Chunk[]>([]);
  const [interimTranscript, setInterimTranscript] = useState<string>('');

  // Derive transcript from chunks (no separate state needed)
  const transcript = useMemo(() => combineChunksToText(finalChunks), [finalChunks]);

  const addChunk = useCallback((text: string, speaker?: string) => {
    const trimmedText = text.trim();
    if (!trimmedText) return;

    setFinalChunks(prev => {
      // Deduplication: if the new text is identical to the last one, skip it
      if (prev.length > 0 && prev[prev.length - 1].text === trimmedText) {
        return prev;
      }

      const chunk = createChunk(trimmedText, speaker);

      // Optimization: Avoid double allocation (spread + slice) when at limit
      // Instead of [...prev, chunk] (N+1 copy) -> slice (N copy),
      // we slice first (N-1 copy) -> push (amortized O(1)).
      if (prev.length >= MAX_CHUNKS) {
        const next = prev.slice(prev.length - MAX_CHUNKS + 1);
        next.push(chunk);
        return next;
      }

      return [...prev, chunk];
    });
  }, []);

  const reset = useCallback(() => {
    setFinalChunks([]);
    setInterimTranscript('');
  }, []);

  return {
    finalChunks,
    interimTranscript,
    transcript,
    addChunk,
    setInterimTranscript,
    reset
  };
};