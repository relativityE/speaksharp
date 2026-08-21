import { useState, useRef, useEffect, useMemo } from 'react';
import { countFillerWords, FillerCounts, createInitialFillerData } from '../../utils/fillerWordUtils';
import { Chunk } from './types';
import { FILLER_WORD_KEYS } from '../../config';
import {
  isFillerCountTraceEnabled,
  pushFillerCountTransition,
  registerFillerTraceResetHook,
  type FillerCountPhase,
} from '../../lib/fillerCountTrace';

/**
 * #1325: project a FillerCounts map onto the privacy-safe trace snapshot.
 *
 * `custom_total` sums ONLY the explicitly configured custom filler words. Built-in discourse markers
 * (like / so / oh / you know) are counted by the product but are NOT custom words, so including them
 * would inflate `custom_total` and make the evidence untruthful — a "so" in "So um I think" must never
 * be reported as a custom-word hit. Raw custom LABELS never leave this hook; only their sum does. No
 * transcript, hypothesis, or token text is read here — only counts.
 */
const CANONICAL_TRACE_KEYS: ReadonlySet<string> = new Set([
  FILLER_WORD_KEYS.UM,
  FILLER_WORD_KEYS.UH,
  FILLER_WORD_KEYS.AH,
]);

function toTraceSnapshot(counts: FillerCounts, userWords: readonly string[]) {
  // Only the caller-configured custom set may contribute, matched case-insensitively against the
  // count-map keys the product actually produced.
  const configured = new Set(userWords.map((word) => word.trim().toLowerCase()).filter(Boolean));
  let customTotal = 0;
  for (const key in counts) {
    if (key === 'total' || CANONICAL_TRACE_KEYS.has(key)) continue;
    if (!configured.has(key.trim().toLowerCase())) continue;
    customTotal += counts[key]?.count ?? 0;
  }
  return {
    um: counts[FILLER_WORD_KEYS.UM]?.count ?? 0,
    uh: counts[FILLER_WORD_KEYS.UH]?.count ?? 0,
    ah: counts[FILLER_WORD_KEYS.AH]?.count ?? 0,
    custom_total: customTotal,
  };
}

/**
 * Record one transition. Inert unless the controlled trace flag is explicitly enabled.
 *
 * Emits only when a phase's canonical payload CHANGES. React may re-run an effect many times with an
 * identical payload; without change detection a rerender storm would fill the bounded 256-event ring
 * and evict the earliest `interim_observed` transition — destroying exactly the evidence #1324 needs.
 * `lastByPhase` is a module-level, per-phase memo of the last emitted payload (reset with the buffer).
 */
const lastEmittedByPhase = new Map<FillerCountPhase, string>();

// Clearing the trace between replays must also clear this memo, or replay N could suppress an event
// identical to replay N-1's and silently inherit the previous fixture's state.
registerFillerTraceResetHook(() => lastEmittedByPhase.clear());

function traceCounts(
  phase: FillerCountPhase,
  counts: FillerCounts | null | undefined,
  userWords: readonly string[],
): void {
  // Flag check FIRST: with tracing off this returns before any allocation, projection, or window
  // access, so the observer cannot cost anything or touch state in production.
  if (!isFillerCountTraceEnabled() || !counts) return;

  const snapshot = toTraceSnapshot(counts, userWords);
  const fingerprint = `${snapshot.um}|${snapshot.uh}|${snapshot.ah}|${snapshot.custom_total}`;
  if (lastEmittedByPhase.get(phase) === fingerprint) return;
  lastEmittedByPhase.set(phase, fingerprint);

  pushFillerCountTransition(phase, snapshot);
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
  // #1325: the trace observers read the configured custom set through a ref so they never add a
  // dependency to (or change the timing of) any existing effect.
  const userWordsForTraceRef = useRef<string[]>(userWords);
  userWordsForTraceRef.current = userWords;

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
    traceCounts('interim_observed', interimCounts, userWordsForTraceRef.current);

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
    traceCounts('final_observed', accumulatedCounts, userWordsForTraceRef.current);
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
    traceCounts('combined', combinedCounts, userWordsForTraceRef.current);
  }, [combinedCounts]);

  return {
    counts: combinedCounts,
    totalCount,
  };
};
