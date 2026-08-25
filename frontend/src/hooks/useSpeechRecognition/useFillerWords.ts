import { useState, useRef, useEffect, useMemo } from 'react';
import { countFillerWords, FillerCounts, createInitialFillerData, withCoachableTotal } from '../../utils/fillerWordUtils';
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
  // #1325: the trace observers read the configured custom set through a ref so they never add a
  // dependency to (or change the timing of) any existing effect.
  const userWordsForTraceRef = useRef<string[]>(userWords);
  userWordsForTraceRef.current = userWords;

  // 1. Handle Final Chunks (Incremental)
  useEffect(() => {
    const userWordsChanged = JSON.stringify(lastUserWordsRef.current) !== JSON.stringify(userWords);
    const allText = finalChunks.map(c => c.transcript).join(' ');

    /**
     * RESET ISOLATION (#1331 RETURN). Clearing the open episode must happen BEFORE any branch can
     * return, and it must clear BOTH the authoritative ref and its rendered mirror.
     *
     * The bug: reordering the append check moved the generic-rewrite `return` ahead of the later
     * "chunks cleared" branch, so on the one transition that matters — a non-empty session being
     * cleared, which changes `allText` — the reset branch never ran. An episode observed in the OLD
     * session then survived into the new one and was committed by the "close with no final
     * contribution" path. The user-word branch had the same hole: evidence gathered under the previous
     * custom set outlived the set that produced it.
     */
    const clearOpenEpisode = () => {
      openEpisodeRef.current = {};
      setOpenEpisodeCounts({});
    };

    const chunksCleared = finalChunks.length === 0 && lastProcessedIndexRef.current !== -1;
    if (chunksCleared) {
      clearOpenEpisode();
      setAccumulatedCounts(createInitialFillerData(userWords));
      lastProcessedIndexRef.current = -1;
      lastProcessedTextRef.current = '';
      lastUserWordsRef.current = userWords;
      return;
    }

    if (userWordsChanged) {
      // Re-process everything if user words change. The open episode is dropped: its per-key maxima
      // were produced under the PREVIOUS custom set, so carrying them forward would let a removed
      // custom word keep contributing. A still-present raw interim is recounted under the new set by
      // the interim effect below, which depends on `userWords`.
      clearOpenEpisode();
      const newCounts = countFillerWords(allText, userWords);
      setAccumulatedCounts(newCounts);
      lastProcessedIndexRef.current = finalChunks.length - 1;
      lastProcessedTextRef.current = allText;
      lastUserWordsRef.current = userWords;
      return;
    }

    // ORDER MATTERS. Appending a chunk changes `allText` AND grows the length, so a text-first check
    // swallowed every append into a full recompute and returned before the episode could be committed
    // — which is why interim-only evidence kept vanishing. An APPEND (length grew, prior text still a
    // prefix) is the normal incremental path; the full recompute below is for a genuine REWRITE, where
    // the previous text is no longer a prefix and incremental arithmetic would be wrong.
    const isAppend = finalChunks.length > lastProcessedIndexRef.current + 1
      && (lastProcessedTextRef.current === '' || allText.startsWith(lastProcessedTextRef.current));

    if (!isAppend && allText !== lastProcessedTextRef.current) {
      setAccumulatedCounts(countFillerWords(allText, userWords));
      lastProcessedIndexRef.current = finalChunks.length - 1;
      lastProcessedTextRef.current = allText;
      return;
    }

    if (isAppend) {
      // Process only new chunks
      const newChunks = finalChunks.slice(lastProcessedIndexRef.current + 1);
      const newText = newChunks.map(c => c.transcript).join(' ');
      const additionalCounts = countFillerWords(newText, userWords);

      // EPISODE CLOSE with a final contribution. The occurrence may appear in BOTH this episode's
      // interim hypotheses and its final text — it was still spoken once — so the episode contributes
      // the MAXIMUM of the two, never their sum. Recognition may also strip a filler before finalizing
      // (interim 1, final 0), which is exactly why the interim maximum still counts; and a filler that
      // only ever appears in the final (interim 0) is preserved by the same maximum.
      const episode = openEpisodeRef.current;
      const contribution: Record<string, number> = {};
      for (const key of new Set([...Object.keys(episode), ...Object.keys(additionalCounts)])) {
        if (key === 'total') continue;
        const value = Math.max(episode[key] ?? 0, additionalCounts[key]?.count ?? 0);
        if (value > 0) contribution[key] = value;
      }
      openEpisodeRef.current = {};
      setOpenEpisodeCounts({});

      if (Object.keys(contribution).length > 0) {
        setAccumulatedCounts(prev => {
          const merged = { ...prev };
          for (const key in contribution) {
            merged[key] = merged[key]
              ? { ...merged[key], count: merged[key].count + contribution[key] }
              : { ...(additionalCounts[key] ?? { count: 0, color: '' }), count: contribution[key] };
          }
          return withCoachableTotal(merged, userWords);
        });
      }

      lastProcessedIndexRef.current = finalChunks.length - 1;
      lastProcessedTextRef.current = allText;
    } else if (!interimTranscript.trim() && Object.keys(openEpisodeRef.current).length > 0) {
      // EPISODE CLOSE with NO final contribution: recognition discarded the hypothesis entirely.
      // The evidence was still observed, so commit the episode maximum on its own. This is the path
      // the 200ms debounce used to destroy for short episodes.
      const contribution = openEpisodeRef.current;
      openEpisodeRef.current = {};
      setOpenEpisodeCounts({});
      setAccumulatedCounts(prev => {
        const merged = { ...prev };
        for (const key in contribution) {
          merged[key] = merged[key]
            ? { ...merged[key], count: merged[key].count + contribution[key] }
            : { count: contribution[key], color: '' };
        }
        return withCoachableTotal(merged, userWords);
      });
    }
    // NOTE: the "chunks cleared" case is handled at the TOP of this effect and returns there. Keeping a
    // second copy here would be two reset implementations free to drift — and the drift is exactly what
    // caused this defect: the reset that lived only down here became unreachable once the append check
    // was reordered above it.
  }, [finalChunks, userWords, interimTranscript]);

  // 2. Handle Interim Transcript — EPISODE IDENTITY (#1324 findings 1 & 2)
  //
  // An EPISODE is one continuous span of interim hypotheses between clears/finalizations. Speech
  // recognition revises a hypothesis in place ("um I" -> "um I think" -> "um I think that"), so within
  // one episode the same spoken "um" reappears in every revision: the per-key MAXIMUM is the honest
  // occurrence count there, and summing revisions would invent occurrences that were never spoken.
  //
  // ACROSS episodes the opposite is true. Five separate utterances each containing one "um" are five
  // spoken occurrences, but the previous code carried `Math.max` across the whole session, so they
  // collapsed to one. The maximum was right; its SCOPE was wrong.
  //
  // So: hold a per-key max for the OPEN episode, and COMMIT it once when the episode closes. Commit is
  // addition; within the episode it stays a maximum. Neither operation replaces the other.
  //
  // The 200ms debounce is retained for RENDER work only. Counting reads the RAW interim, because the
  // debounce timer is cleared when the interim clears — so an episode shorter than 200ms had its
  // evidence cancelled before it was ever counted. Correctness must not depend on a timer firing.
  const [debouncedInterim, setDebouncedInterim] = useState(interimTranscript);

  useEffect(() => {
    if (!interimTranscript.trim()) {
      setDebouncedInterim('');
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedInterim(interimTranscript);
    }, 200);
    return () => clearTimeout(timer);
  }, [interimTranscript]);

  /** Per-key maximum observed in the OPEN episode. Not yet committed to the session. */
  const openEpisodeRef = useRef<Record<string, number>>({});
  /** Mirrors openEpisodeRef into render output without making counting depend on a state flush. */
  const [openEpisodeCounts, setOpenEpisodeCounts] = useState<Record<string, number>>({});

  // RAW interim — deliberately not the debounced value. See above.
  const rawInterimCounts = useMemo(() => {
    if (!interimTranscript.trim()) return null;
    return countFillerWords(interimTranscript, userWords);
  }, [interimTranscript, userWords]);

  // Kept for the existing trace contract, which observes the debounced hypothesis.
  const interimCounts = useMemo(() => {
    if (!debouncedInterim.trim()) return null;
    return countFillerWords(debouncedInterim, userWords);
  }, [debouncedInterim, userWords]);

  useEffect(() => {
    if (!interimCounts) return;
    traceCounts('interim_observed', interimCounts, userWordsForTraceRef.current);
  }, [interimCounts]);

  useEffect(() => {
    if (!rawInterimCounts) return;
    const next: Record<string, number> = { ...openEpisodeRef.current };
    let changed = false;
    for (const key in rawInterimCounts) {
      if (key === 'total') continue;
      const observed = rawInterimCounts[key].count;
      if (observed > (next[key] ?? 0)) { next[key] = observed; changed = true; }
    }
    if (changed) {
      openEpisodeRef.current = next;
      setOpenEpisodeCounts(next);
    }
  }, [rawInterimCounts]);

  // #1325 §9: observe the FINAL-derived accumulation as its own phase. A separate read-only effect
  // keeps the emission out of the accumulation logic above, so tracing cannot perturb counts/timing.
  //
  // ZERO IS EVIDENCE. The gate is whether the final phase actually EXECUTED — i.e. real final chunks
  // arrived — never `count > 0`. Suppressing a zero would make "recognized speech containing no
  // fillers" indistinguishable from "the phase never ran", which is exactly the rung B vs D/E
  // distinction #1324 depends on. A mount-time zero render has no final chunks, so it stays silent
  // and an executed-zero phase remains distinguishable from a never-executed one.
  useEffect(() => {
    if (finalChunks.length === 0) return;
    traceCounts('final_observed', accumulatedCounts, userWordsForTraceRef.current);
  }, [accumulatedCounts, finalChunks.length]);

  // 3. Combine committed session evidence with the OPEN episode.
  //
  // `accumulatedCounts` already holds every CLOSED episode's reconciled contribution, so the only
  // thing left to surface is the episode currently in flight — added, because it is a distinct
  // occurrence, while its own revisions were already collapsed to a maximum before it got here.
  const combinedCounts = useMemo(() => {
    const combined: FillerCounts = { ...accumulatedCounts };

    for (const key in openEpisodeCounts) {
      const observed = openEpisodeCounts[key];
      if (observed <= 0) continue;
      combined[key] = combined[key]
        ? { ...combined[key], count: combined[key].count + observed }
        : { count: observed, color: '' };
    }

    return withCoachableTotal(combined, userWords);
  }, [accumulatedCounts, openEpisodeCounts, userWords]);

  const totalCount = useMemo(() => combinedCounts.total.count, [combinedCounts]);

  // #1325 §9: the canonical user-facing map. Comparing it against the interim/final phases shows
  // whether observed evidence survived into the value the session actually reports.
  //
  // ZERO IS EVIDENCE here too: once recognition has actually executed (an interim was observed or
  // final chunks arrived), a combined ZERO must be emitted — "the session reported 0 fillers" is a
  // materially different claim from "the combined phase never ran". Change-deduplication still
  // collapses repeated identical zero renders, so a mount-time zero cannot fill the ring.
  const combinedPhaseExecuted = finalChunks.length > 0 || interimCounts !== null;
  useEffect(() => {
    if (!combinedPhaseExecuted) return;
    traceCounts('combined', combinedCounts, userWordsForTraceRef.current);
  }, [combinedCounts, combinedPhaseExecuted]);

  return {
    counts: combinedCounts,
    totalCount,
  };
};
