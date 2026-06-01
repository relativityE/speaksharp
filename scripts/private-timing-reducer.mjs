/**
 * Private STT timing reducer (no browser).
 *
 * Implements test-report "Unit-testable checks without browser" #1:
 *   "given Private trace events, computes firstDraftDelay, stopToWholeStart,
 *    wholeDecodeDuration, stopFinalizationMs."
 *
 * Pure + dependency-free. Consumes the `privateTrace` array (window
 * __PRIVATE_STT_TIMELINE__ events) captured in corpus artifacts so timing
 * analysis is reproducible and regression-guarded without Chrome.
 */

function findEvent(trace, name) {
  return Array.isArray(trace) ? trace.find((e) => e && e.event === name) : undefined;
}

function epoch(event) {
  return event && typeof event.epochMs === 'number' ? event.epochMs : null;
}

function delta(a, b) {
  return a != null && b != null ? a - b : null;
}

/**
 * @param {Array<{event:string, epochMs?:number, payload?:object}>} trace
 * @param {{ firstTextMs?: number|null }} [row] optional row for firstDraftDelay
 * @returns timing breakdown in ms (nulls where the event is absent)
 */
export function reducePrivateTiming(trace, row = {}) {
  const stop = findEvent(trace, 'stop_requested');
  const wholeStart = findEvent(trace, 'whole_utterance_commit_start');
  const wholeAccept = findEvent(trace, 'whole_utterance_commit_accept');
  const stopComplete = findEvent(trace, 'stop_force_processing_complete');

  // First draft: prefer the row's measured firstTextMs; else first provisional emit
  // offset from stream_start.
  const streamStart = findEvent(trace, 'stream_start');
  const firstPartial = findEvent(trace, 'first_transcript_provisional_partial_emit')
    ?? findEvent(trace, 'transcript_callback_emit');
  const firstDraftDelay = typeof row.firstTextMs === 'number'
    ? row.firstTextMs
    : delta(epoch(firstPartial), epoch(streamStart));

  return {
    firstDraftDelay,
    stopToWholeStart: delta(epoch(wholeStart), epoch(stop)),
    wholeDecodeDuration: delta(epoch(wholeAccept), epoch(wholeStart)),
    stopFinalizationMs: typeof row.stopFinalizationMs === 'number'
      ? row.stopFinalizationMs
      : delta(epoch(stopComplete), epoch(stop)),
    // Diagnostic: did the post-Stop latency fix skip the redundant forced-tail decode?
    forcedTailSkipped: Boolean(findEvent(trace, 'stop_force_tail_skipped')),
    forcedTailFallback: Boolean(findEvent(trace, 'stop_force_tail_fallback')),
  };
}
