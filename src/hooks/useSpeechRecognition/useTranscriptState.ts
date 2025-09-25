import { useState, useCallback, useEffect } from 'react';
import { Chunk } from './types';
import { combineChunksToText, createChunk } from './utils';
import { limitArray } from '../../utils/fillerWordUtils';

const MAX_CHUNKS = 1000;

export const useTranscriptState = () => {
  const [finalChunks, setFinalChunks] = useState<Chunk[]>([]);
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [transcript, setTranscript] = useState<string>('');

  // Single effect: update transcript when chunks change
  useEffect(() => {
    setTranscript(combineChunksToText(finalChunks));
  }, [finalChunks]);

  const addChunk = useCallback((text: string, speaker?: string) => {
    const chunk = createChunk(text, speaker);
    setFinalChunks(prev => limitArray([...prev, chunk], MAX_CHUNKS));
  }, []);

  const reset = useCallback(() => {
    setFinalChunks([]);
    setInterimTranscript('');
    setTranscript('');
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