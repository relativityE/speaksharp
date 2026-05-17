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
  // Browser STT can revise interim hypotheses by removing fillers before finalizing.
  // Preserve observed interim filler evidence so live metrics do not snap back to
  // an unrealistically clean score.
  const [observedInterimCounts, setObservedInterimCounts] = useState<FillerCounts>(() => createInitialFillerData(userWords));

  // 1. Handle Final Chunks (Incremental)
  useEffect(() => {
    const userWordsChanged = JSON.stringify(lastUserWordsRef.current) !== JSON.stringify(userWords);

    if (userWordsChanged) {
      // Re-process everything if user words change
      const allText = finalChunks.map(c => c.transcript).join(' ');
      const newCounts = countFillerWords(allText, userWords);
      setAccumulatedCounts(newCounts);
      setObservedInterimCounts(createInitialFillerData(userWords));
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
      setObservedInterimCounts(createInitialFillerData(userWords));
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

  useEffect(() => {
    if (!interimCounts) return;

    setObservedInterimCounts(prev => {
      const observed = { ...prev };

      for (const key in interimCounts) {
        if (key === 'total') continue;
        const currentCount = observed[key]?.count ?? 0;
        const nextCount = Math.max(currentCount, interimCounts[key].count);
        observed[key] = {
          ...(observed[key] || interimCounts[key]),
          count: nextCount,
        };
      }

      observed.total = {
        ...observed.total,
        count: Object.entries(observed).reduce((sum, [key, data]) => key === 'total' ? sum : sum + data.count, 0),
      };
      return observed;
    });
  }, [interimCounts]);

  // 3. Combine Accumulated, observed interim, and current interim counts
  const combinedCounts = useMemo(() => {
    const combined = { ...accumulatedCounts };
    const transientEvidence = observedInterimCounts;

    for (const key in transientEvidence) {
      if (key === 'total') continue;
      const observedCount = Math.max(transientEvidence[key]?.count ?? 0, interimCounts?.[key]?.count ?? 0);
      if (observedCount <= 0) continue;
      if (!combined[key]) {
        combined[key] = { ...transientEvidence[key], count: observedCount };
      } else {
        combined[key] = {
          ...combined[key],
          count: Math.max(combined[key].count, observedCount)
        };
      }
    }

    combined.total = {
      ...combined.total,
      count: Object.entries(combined).reduce((sum, [key, data]) => key === 'total' ? sum : sum + data.count, 0),
    };

    return combined;
  }, [accumulatedCounts, interimCounts, observedInterimCounts]);

  const totalCount = useMemo(() => combinedCounts.total.count, [combinedCounts]);

  return {
    counts: combinedCounts,
    totalCount,
  };
};
