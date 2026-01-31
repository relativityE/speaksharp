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

      if (prev.length >= MAX_CHUNKS) {
        // Optimization: Avoid double-copying by slicing and pushing instead of spread + limitArray
        const next = prev.slice(1);
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