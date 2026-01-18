import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  // Derived final filler data (no side effects, no render loop)
  const finalFillerData = useMemo(() => {
    const finalText = finalChunks.map(c => c.text).join(' ');
    if (!finalText.trim()) return createInitialFillerData(customWords);
    try {
      return countFillerWords(finalText, customWords);
    } catch (err) {
      console.error('Error counting final filler words:', err);
      return createInitialFillerData(customWords);
    }
  }, [finalChunks, customWords]);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Effect: Debounced live filler counting
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = setTimeout(() => {
      const fullText = createFullTranscript(finalChunks, interimTranscript);
      try {
        const counts = countFillerWords(fullText, customWords);
        setFillerData(prev => {
          // Optimization: Prevent infinite render loops by checking if data actually changed
          if (JSON.stringify(prev) === JSON.stringify(counts)) {
            return prev;
          }
          return counts;
        });
      } catch (err) {
        console.error('Error counting live filler words:', err);
      }
    }, 50);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [finalChunks, interimTranscript, customWords]);

  const reset = useCallback(() => {
    const initial = createInitialFillerData(customWords);
    setFillerData(initial);
  }, [customWords]);

  return { fillerData, finalFillerData, reset };
};