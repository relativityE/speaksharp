import { useState, useRef, useEffect, useMemo } from 'react';
import { countFillerWords, FillerCounts, createInitialFillerData } from '../../utils/fillerWordUtils';
import { Chunk } from './types';
import { FILLER_WORD_KEYS } from '../../config';
import {
  isFillerCountTraceEnabled,
  pushFillerCountTransition,
  type FillerCountPhase,
} from '../../lib/fillerCountTrace';

/**
 * #1325: project a FillerCounts map onto the privacy-safe trace snapshot.
 *
 * Canonical true-filler keys are emitted individually; every other key (user-defined custom words) is
 * summed into `custom_total` so a raw custom-word LABEL can never leave this hook. No transcript,
 * hypothesis, or token text is read here — only counts.
 */
const CANONICAL_TRACE_KEYS: ReadonlySet<string> = new Set([
  FILLER_WORD_KEYS.UM,
  FILLER_WORD_KEYS.UH,
  FILLER_WORD_KEYS.AH,
]);

function toTraceSnapshot(counts: FillerCounts) {
  let customTotal = 0;
  for (const key in counts) {
    if (key === 'total' || CANONICAL_TRACE_KEYS.has(key)) continue;
    customTotal += counts[key]?.count ?? 0;
  }
  return {
    um: counts[FILLER_WORD_KEYS.UM]?.count ?? 0,
    uh: counts[FILLER_WORD_KEYS.UH]?.count ?? 0,
    ah: counts[FILLER_WORD_KEYS.AH]?.count ?? 0,
    custom_total: customTotal,
  };
}

/** Record one transition. Inert unless the controlled trace flag is explicitly enabled. */
function traceCounts(phase: FillerCountPhase, counts: FillerCounts | null | undefined): void {
  if (!counts || !isFillerCountTraceEnabled()) return;
  pushFillerCountTransition(phase, toTraceSnapshot(counts));
}

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
  const lastProcessedTextRef = useRef<string>('');
  // Browser STT can revise interim hypotheses by removing fillers before finalizing.
  // Preserve observed interim filler evidence so live metrics do not snap back to
  // an unrealistically clean score.
  const [observedInterimCounts, setObservedInterimCounts] = useState<FillerCounts>(() => createInitialFillerData(userWords));

  // 1. Handle Final Chunks (Incremental)
  useEffect(() => {
    const userWordsChanged = JSON.stringify(lastUserWordsRef.current) !== JSON.stringify(userWords);
    const allText = finalChunks.map(c => c.transcript).join(' ');

    if (userWordsChanged) {
      // Re-process everything if user words change
      const newCounts = countFillerWords(allText, userWords);
      setAccumulatedCounts(newCounts);
      setObservedInterimCounts(createInitialFillerData(userWords));
      lastProcessedIndexRef.current = finalChunks.length - 1;
      lastProcessedTextRef.current = allText;
      lastUserWordsRef.current = userWords;
      return;
    }

    if (allText !== lastProcessedTextRef.current) {
      setAccumulatedCounts(countFillerWords(allText, userWords));
      lastProcessedIndexRef.current = finalChunks.length - 1;
      lastProcessedTextRef.current = allText;
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
      lastProcessedTextRef.current = '';
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

    // #1325: the interim hypothesis produced these counts. Recording this transition is what lets the
    // qualification harness prove a true filler WAS counted from interim even if the final drops it.
    traceCounts('interim_observed', interimCounts);

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

  // #1325: observe the FINAL-derived accumulation as its own phase. A separate read-only effect keeps
  // the emission out of the accumulation logic above, so tracing cannot perturb counts or timing.
  useEffect(() => {
    if (accumulatedCounts.total.count <= 0) return;
    traceCounts('final_observed', accumulatedCounts);
  }, [accumulatedCounts]);

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

  // #1325: the canonical user-facing map. Comparing this against the interim/final phases shows
  // whether observed evidence survived into the value the session actually reports.
  useEffect(() => {
    if (combinedCounts.total.count <= 0) return;
    traceCounts('combined', combinedCounts);
  }, [combinedCounts]);

  return {
    counts: combinedCounts,
    totalCount,
  };
};
