import { useState, useRef, useEffect, useMemo } from 'react';
import { countFillerWords, FillerCounts, createInitialFillerData } from '../../utils/fillerWordUtils';
import { Chunk } from './types';

/**
 * Hook: useFillerWords (Optimized)
 * Tracks filler word counts incrementally.
 */
export const useFillerWords = (finalChunks: Chunk[], interimTranscript: string, userWords: string[] = []) => {
  // Accumulated counts for all completed chunks
  const [accumulatedCounts, setAccumulatedCounts] = useState<FillerCounts>(() => createInitialFillerData(userWords));
  // Keep track of which chunks have been processed
  const lastProcessedIndexRef = useRef<number>(-1);
  // Keep track of userWords to detect changes
  const lastUserWordsRef = useRef<string[]>(userWords);

  // 1. Handle Final Chunks (Incremental)
  useEffect(() => {
    const userWordsChanged = JSON.stringify(lastUserWordsRef.current) !== JSON.stringify(userWords);

    if (userWordsChanged) {
      // Re-process everything if user words change
      const allText = finalChunks.map(c => c.transcript).join(' ');
      const newCounts = countFillerWords(allText, userWords);
      setAccumulatedCounts(newCounts);
      lastProcessedIndexRef.current = finalChunks.length - 1;
      lastUserWordsRef.current = userWords;
      return;
    }

    if (finalChunks.length > lastProcessedIndexRef.current + 1) {
      // Process only new chunks
      const newChunks = finalChunks.slice(lastProcessedIndexRef.current + 1);
      const newText = newChunks.map(c => c.transcript).join(' ');
      const additionalCounts = countFillerWords(newText, userWords);

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
      setAccumulatedCounts(createInitialFillerData(userWords));
      lastProcessedIndexRef.current = -1;
    }
  }, [finalChunks, userWords]);

  // 2. Handle Interim Transcript (Transient)
  // Debounce interim processing to avoid excessive NLP work during rapid speech recognition updates.
  const [debouncedInterim, setDebouncedInterim] = useState(interimTranscript);

  useEffect(() => {
    // Immediate clear if transcript is empty to avoid double-counting during finalization
    if (!interimTranscript.trim()) {
      setDebouncedInterim('');
      return;
    }

    const timer = setTimeout(() => {
      setDebouncedInterim(interimTranscript);
    }, 200);

    return () => clearTimeout(timer);
  }, [interimTranscript]);

  const interimCounts = useMemo(() => {
    if (!debouncedInterim.trim()) return null;
    return countFillerWords(debouncedInterim, userWords);
  }, [debouncedInterim, userWords]);

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
