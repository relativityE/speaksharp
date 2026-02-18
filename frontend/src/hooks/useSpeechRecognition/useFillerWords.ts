import { useState, useRef, useEffect, useMemo } from 'react';
import { countFillerWords, FillerCounts, createInitialFillerData } from '../../utils/fillerWordUtils';
import { Chunk } from './types';

/**
 * Hook: useFillerWords (Optimized)
 * Tracks filler word counts incrementally.
 */
export const useFillerWords = (finalChunks: Chunk[], interimTranscript: string, customWords: string[] = []) => {
  // Accumulated counts for all completed chunks
  const [accumulatedCounts, setAccumulatedCounts] = useState<FillerCounts>(() => createInitialFillerData(customWords));
  // Keep track of which chunks have been processed
  const lastProcessedIndexRef = useRef<number>(-1);
  // Keep track of customWords to detect changes
  const lastCustomWordsRef = useRef<string[]>(customWords);

  // 1. Handle Final Chunks (Incremental)
  useEffect(() => {
    const customWordsChanged = JSON.stringify(lastCustomWordsRef.current) !== JSON.stringify(customWords);

    if (customWordsChanged) {
      // Re-process everything if custom words change
      const allText = finalChunks.map(c => c.text).join(' ');
      const newCounts = countFillerWords(allText, customWords);
      setAccumulatedCounts(newCounts);
      lastProcessedIndexRef.current = finalChunks.length - 1;
      lastCustomWordsRef.current = customWords;
      return;
    }

    if (finalChunks.length > lastProcessedIndexRef.current + 1) {
      // Process only new chunks
      const newChunks = finalChunks.slice(lastProcessedIndexRef.current + 1);
      const newText = newChunks.map(c => c.text).join(' ');
      const additionalCounts = countFillerWords(newText, customWords);

      if (additionalCounts.total.count > 0) {
        setAccumulatedCounts(prev => {
          const merged = { ...prev };
          let totalAdded = 0;

          for (const key in additionalCounts) {
            if (key === 'total') continue;
            if (!merged[key]) {
              merged[key] = { ...additionalCounts[key] };
            } else {
              merged[key] = {
                ...merged[key],
                count: merged[key].count + additionalCounts[key].count
              };
            }
            totalAdded += additionalCounts[key].count;
          }

          merged.total = {
            ...merged.total,
            count: merged.total.count + totalAdded
          };

          return merged;
        });
      }

      lastProcessedIndexRef.current = finalChunks.length - 1;
    } else if (finalChunks.length === 0 && lastProcessedIndexRef.current !== -1) {
      // Reset if chunks are cleared
      setAccumulatedCounts(createInitialFillerData(customWords));
      lastProcessedIndexRef.current = -1;
    }
  }, [finalChunks, customWords]);

  // 2. Handle Interim Transcript (Transient)
  const interimCounts = useMemo(() => {
    if (!interimTranscript.trim()) return null;
    return countFillerWords(interimTranscript, customWords);
  }, [interimTranscript, customWords]);

  // 3. Combine Accumulated and Interim Counts
  const combinedCounts = useMemo(() => {
    if (!interimCounts) return accumulatedCounts;

    const combined = { ...accumulatedCounts };
    let totalAdded = 0;

    for (const key in interimCounts) {
      if (key === 'total') continue;
      if (!combined[key]) {
        combined[key] = { ...interimCounts[key] };
      } else {
        combined[key] = {
          ...combined[key],
          count: combined[key].count + interimCounts[key].count
        };
      }
      totalAdded += interimCounts[key].count;
    }

    combined.total = {
      ...combined.total,
      count: combined.total.count + totalAdded
    };

    return combined;
  }, [accumulatedCounts, interimCounts]);

  const totalCount = useMemo(() => combinedCounts.total.count, [combinedCounts]);

  return {
    counts: combinedCounts,
    totalCount,
  };
};
