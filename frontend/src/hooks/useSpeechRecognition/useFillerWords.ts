import { useState, useEffect, useCallback, useRef } from 'react';
import { Chunk } from './types';
import { createFullTranscript } from './utils';
import {
  createInitialFillerData,
  countFillerWords,
  FillerCounts
} from '../../utils/fillerWordUtils';

export const useFillerWords = (
  finalChunks: Chunk[],
  interimTranscript: string,
  customWords: string[]
) => {
  const [fillerData, setFillerData] = useState<FillerCounts>(() =>
    createInitialFillerData(customWords)
  );
  const [finalFillerData, setFinalFillerData] = useState<FillerCounts>(() =>
    createInitialFillerData(customWords)
  );

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Effect 1: Update final filler data (immediate, no debouncing)
  useEffect(() => {
    const finalText = finalChunks.map(c => c.text).join(' ');
    if (finalText.trim()) {
      try {
        const counts = countFillerWords(finalText, customWords);
        setFinalFillerData(counts);
      } catch (err) {
        console.error('Error counting final filler words:', err);
      }
    }
  }, [finalChunks, customWords]);

  // Effect 2: Debounced live filler counting
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = setTimeout(() => {
      const fullText = createFullTranscript(finalChunks, interimTranscript);
      if (fullText.trim()) {
        try {
          const counts = countFillerWords(fullText, customWords);
          setFillerData(counts);
        } catch (err) {
          console.error('Error counting live filler words:', err);
        }
      }
    }, 50);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [finalChunks, interimTranscript, customWords]);

  const reset = useCallback(() => {
    const initial = createInitialFillerData(customWords);
    setFillerData(initial);
    setFinalFillerData(initial);
  }, [customWords]);

  return { fillerData, finalFillerData, reset };
};