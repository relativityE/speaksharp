import React, { useCallback, useEffect, useRef, useState } from 'react';
import { OnDeviceCountsContext } from './onDeviceCounts';
import { Sparkles } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '../../lib/logger';
import { emitPracticeLoop } from '@/services/telemetry/practiceLoopTelemetry';
import { markCompletionStage } from '@/services/telemetry/completionStages';
import {
  trackPracticeLoopReviewCompleted,
  trackPracticeLoopReviewFailed,
  trackPracticeLoopReviewPersisted,
  trackPracticeLoopReviewRendered,
  trackPracticeLoopReviewRequested,
  type PracticeLoopReviewFailureReason,
} from '@/services/practiceLoopTelemetry';

interface AISuggestionsData {
  version: 'gemini_coaching_v1';
  what_worked: string;
  what_to_try_next: string;
}

interface AISuggestionsProps {
  /** Legacy callers may still provide text only to indicate availability. It is never sent to the edge function. */
  transcript?: string;
  /** Completed-session authority from SessionPage: persistence is terminal and the final snapshot had words. */
  canReview?: boolean;
  sessionId?: string;
  initialSuggestions?: AISuggestionsData;
  /** #1473 — delay before the single automatic retry of a recoverable failure. Product uses the default. */
  retryBackoffMs?: number;
  /**
   * S-14 — the counts computed ON DEVICE from the transcript. They never depended on the network, which is
   * the whole point: while the review is still coming, they fill the space the verdict will occupy, so the
   * slot is never empty. Omit a value that is not measured; a count is never stubbed, zeroed or em-dashed.
   */
  onDeviceCounts?: { fillers: number | null; wordsPerMinute: number | null };
  /** S-12 — `Session 6 · Open Mic`, shown opposite the eyebrow when the review is not still coming. */
  sessionLabel?: string | null;
  /**
   * #1258 — which product this take was. Sent with the request so the coaching function refuses to write generic
   * coaching for a Focus Points take whose saved point results are not there yet. It never supplies evidence.
   */
  product?: 'open_mic' | 'focus_points';
  /**
   * #1258 — why this take's review will NOT be requested (e.g. its Focus Points check ended without results).
   * Shown in place of the generic not-ready line; nothing is requested or retried while it is set.
   */
  blockedReason?: string | null;
}

interface SafeSuggestionError {
  message: string;
  reason: PracticeLoopReviewFailureReason;
}

const parseAISuggestions = (value: unknown): AISuggestionsData | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(['version', 'what_to_try_next', 'what_worked'])) return null;
  if (candidate.version !== 'gemini_coaching_v1') return null;
  if (typeof candidate.what_worked !== 'string' || !candidate.what_worked.trim()) return null;
  if (typeof candidate.what_to_try_next !== 'string' || !candidate.what_to_try_next.trim()) return null;
  return {
    version: 'gemini_coaching_v1',
    what_worked: candidate.what_worked.trim(),
    what_to_try_next: candidate.what_to_try_next.trim(),
  };
};

/**
 * The HTTP status the edge function actually returned, or null when there is none to read.
 *
 * `supabase.functions.invoke` rejects with a `FunctionsHttpError` carrying the `Response` on `context`;
 * a transport failure rejects with `FunctionsFetchError`, which has no status at all. Reading the status
 * is the only way to learn what the server decided — the message is prose written for a human.
 */
const errorStatus = (err: unknown): number | null => {
  const ctx = (err as { context?: unknown } | null)?.context;
  const fromContext = (ctx as { status?: unknown } | null)?.status;
  if (typeof fromContext === 'number') return fromContext;
  const direct = (err as { status?: unknown } | null)?.status;
  return typeof direct === 'number' ? direct : null;
};

/** A rejection with no status is a transport failure — the request never reached a verdict. */
const isTransportFailure = (err: unknown): boolean => {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'FunctionsFetchError' || name === 'TypeError' || name === 'AbortError';
};

/**
 * Classify a failed review request FROM THE SERVER'S STATUS, never from its prose.
 *
 * This matched substrings — `'403'`, `'quota'`, `'transcript'`, `'not found'` — against the error
 * message. Three things were wrong with that, and only the first is obvious:
 *
 *   1. It is guesswork. A message reworded upstream silently reclassifies every one of these outcomes,
 *      and the user is then told the wrong thing about their own session — "your account cannot do this"
 *      when the truth was a temporary outage.
 *   2. It matched the WRONG failures. A transcript that genuinely could not be fetched produced a
 *      network error whose message contains "transcript", which reported `transcript_unavailable` — a
 *      statement about their saved data — for what was actually a connectivity blip.
 *   3. The message is the field most likely to carry echoed request material, so pattern-matching it
 *      couples product behaviour to a string we deliberately never look at anywhere else.
 *
 * The status is what the server decided. The mapping below is taken from the function's own responses.
 */
/** #1473 — the ONLY closed code the edge function may send, and the only one this client acts on. */
const SERVICE_CONFIGURATION_CODE = 'service_configuration';

/**
 * #1473 — read the allowlisted closed code from the edge function's JSON body, DEFENSIVELY.
 *
 * `FunctionsHttpError.context` is the `Response`. It is CLONED before reading, so nothing else that inspects the
 * response finds a consumed body. Only the exact allowlisted value is returned: a missing, malformed or unknown body
 * yields null, and the caller falls back to the status classification it has always used.
 */
const readClosedCode = async (err: unknown): Promise<typeof SERVICE_CONFIGURATION_CODE | null> => {
  const ctx = (err as { context?: unknown } | null)?.context as { clone?: unknown } | undefined;
  if (!ctx || typeof ctx.clone !== 'function') return null;
  try {
    const body: unknown = await (ctx.clone as () => { json: () => Promise<unknown> })().json();
    return (body as { code?: unknown } | null)?.code === SERVICE_CONFIGURATION_CODE ? SERVICE_CONFIGURATION_CODE : null;
  } catch {
    return null;
  }
};

/**
 * #1473 — failures another automatic attempt cannot change. They are terminal: the user sees the saved-session
 * assurance and one manual action.
 *
 * #1486 — `unavailable` IS TERMINAL, AND THAT IS A QUOTA RULE, NOT A PESSIMISM.
 *
 * `unavailable` is the provider/5xx answer, and the edge function consumes a quota slot BEFORE it calls the
 * provider. Re-entering the whole function therefore spends a second slot on one generation action, and if the
 * first attempt took the user's last slot the retry comes back 429 — which this file maps to `rate_limited` and
 * reports as a limit the user never reached, hiding the outage that actually happened. The provider retry now
 * lives inside the edge function, behind that single consumption (`AI_PROVIDER_ATTEMPTS`), so a provider blip is
 * still absorbed and costs nothing; by the time the client sees `unavailable` the provider has already been asked
 * twice and a third ask can only charge again.
 *
 * `network` stays recoverable. It is the one failure with no response at all, so it carries no quota receipt to
 * double, and it is usually the client's own connection rather than anything we did.
 *
 * `invalid_response` is terminal too. The edge function answers 200 only after it has persisted and read back the
 * exact review, so a malformed 200 is a contract violation, not a provider or network blip. Another attempt re-reads
 * the same stored value.
 */
const TERMINAL_REASONS: ReadonlySet<PracticeLoopReviewFailureReason> = new Set<PracticeLoopReviewFailureReason>([
  'service_configuration', 'access_denied', 'rate_limited', 'not_found', 'transcript_unavailable', 'invalid_response',
  'unavailable',
]);

/**
 * #1258 — how many times a `425 focus_results_pending` answer is waited out. The server sends it BEFORE quota or any
 * provider call when a Focus Points take's saved point results have not landed yet (a brief read lag after the save),
 * so waiting costs nothing and does not use one of the two lifecycle attempts. Bounded: after these waits the answer
 * is the ordinary terminal "unavailable", with the manual retry.
 */
export const FOCUS_RESULTS_PENDING_WAITS = 3;

/** #1473 — the bounded backoff before the single automatic retry of a recoverable failure. */
export const AI_REVIEW_AUTO_RETRY_BACKOFF_MS = 2500;

const UNAVAILABLE_MESSAGE = 'The review is unavailable right now. Your session is saved, and you can try again.';

const getSafeAiSuggestionError = (
  err: unknown,
  closedCode: typeof SERVICE_CONFIGURATION_CODE | null = null,
): SafeSuggestionError => {
  if (isTransportFailure(err) && errorStatus(err) === null) {
    return { reason: 'network', message: 'The review could not connect. Check your connection and try again.' };
  }

  // #1473 — the server's closed code, honoured only on the status the edge function sends it with.
  if (closedCode === SERVICE_CONFIGURATION_CODE && errorStatus(err) === 503) {
    return {
      reason: 'service_configuration',
      message: 'The review is unavailable because of a service setup problem on our side. Your session is saved, and you can check again later.',
    };
  }

  switch (errorStatus(err)) {
    // 401 authentication failed · 403 trial has ended — both are "this account may not, right now".
    case 401:
    case 403:
      return { reason: 'access_denied', message: 'Your account cannot request a new review right now. Your saved session is unchanged.' };
    // 429 daily coaching limit reached.
    case 429:
      return { reason: 'rate_limited', message: 'Review requests are temporarily limited. Your session is saved; please try again later.' };
    // 409 the saved session has no available transcript. The ONLY status that licenses a claim about
    // their stored data, which is why it must never be inferred from prose.
    case 409:
      return { reason: 'transcript_unavailable', message: 'This saved session does not have a transcript available for review.' };
    // 404 the session was not found.
    case 404:
      return { reason: 'not_found', message: 'This saved session could not be found. Your other sessions are unchanged.' };
    // 400 bad request, 500/502/503 upstream or provider trouble, and anything unrecognised. All of them
    // mean "not now", and none of them licenses a claim about the user's account or their data.
    default:
      return { reason: 'unavailable', message: UNAVAILABLE_MESSAGE };
  }
};

const AISuggestions: React.FC<AISuggestionsProps> = ({
  transcript = '', canReview, sessionId, initialSuggestions, retryBackoffMs = AI_REVIEW_AUTO_RETRY_BACKOFF_MS,
  onDeviceCounts, sessionLabel, product, blockedReason,
}) => {
  const activeSessionRef = useRef(sessionId);
  const requestGenerationRef = useRef(0);
  if (activeSessionRef.current !== sessionId) {
    activeSessionRef.current = sessionId;
    requestGenerationRef.current += 1;
  }
  const [view, setView] = useState(() => ({
    sessionId,
    suggestions: parseAISuggestions(initialSuggestions),
    isLoading: false,
    error: null as string | null,
    /** #1473 — a recoverable failure is showing and ONE automatic retry is scheduled; no attempt is in flight. */
    retrying: false,
  }));

  // A route change can reuse this component instance. Render the new session's persisted value
  // immediately and invalidate every request captured for the previous session.
  const currentView = view.sessionId === sessionId
    ? view
    : { sessionId, suggestions: parseAISuggestions(initialSuggestions), isLoading: false, error: null, retrying: false };
  const { suggestions, isLoading, error, retrying } = currentView;
  const reviewReady = Boolean(sessionId && (canReview ?? Boolean(transcript.trim())));
  const reviewCardRef = useRef<HTMLDivElement>(null);
  const renderedReceiptRef = useRef<string | null>(null);

  useEffect(() => {
    setView({
      sessionId,
      suggestions: parseAISuggestions(initialSuggestions),
      isLoading: false,
      error: null,
      retrying: false,
    });
  }, [sessionId, initialSuggestions]);

  /**
   * #1422 Codex P1 `3994409733` (PM RETURN `5642224586`, option (b)) — THE RECEIPT IS EMITTED WHERE THE
   * REVIEW IS OWNED.
   *
   * `SessionOverhaulView` used to emit the Open Mic generated-review receipt and mark
   * `practice_loop_ready` / `review_rendered` as soon as the after-state settled, reading a prop
   * (`aiSuggestions`) that production leaves undefined — `SessionPage` passes `undefined` and the real
   * result lives here. So every completion published a zero-takeaway `no_suggestions` receipt and marked
   * both completion stages BEFORE generation finished, and even when it failed: release evidence claiming
   * a state the user never reached.
   *
   * This component owns the validated result and the rendered card, so it owns the claim. The guard below
   * is the whole contract:
   *
   *   - `suggestions` is non-null only for a result that passed `parseAISuggestions` — exactly one
   *     `what_worked` and one `what_to_try_next`, both non-blank. Loading, empty, invalid and failed
   *     requests leave it null, so none of them reaches this line.
   *   - `suggestions` is read from `currentView`, which is discarded when `sessionId` changes, so a
   *     superseded session cannot publish for the current one.
   *   - the card must intersect the viewport before the rendered receipt or `review_rendered` is published.
   *     A result below the fold is available — `practice_loop_ready` is marked by its own effect below — but
   *     it is not rendered to the user yet.
   *   - `renderedReceiptRef` keys on the session, so a visible valid review publishes exactly once per
   *     session however often the screen re-renders or the observer fires.
   *
   * Content-free, as before: two counts, booleans and closed enums. No session id, no prose, no provider
   * error text.
   */
  useEffect(() => {
    if (!sessionId || !suggestions || renderedReceiptRef.current === sessionId) return;
    const card = reviewCardRef.current;
    if (!card) return;

    let observer: IntersectionObserver | null = null;
    const publishVisibleReview = () => {
      if (renderedReceiptRef.current === sessionId) return;
      renderedReceiptRef.current = sessionId;
      trackPracticeLoopReviewRendered();
      emitPracticeLoop({
        // The validated card has intersected the viewport. This is the only phase that can claim that.
        phase: 'rendered',
        reviewSurface: 'coaching_verdict',
        // The contract is exactly one of each, and `parseAISuggestions` has already refused anything else.
        whatWentWellCount: 1,
        whatToImproveCount: 1,
        suggestionsPresent: true,
        whatWentWellSource: 'generated',
        whatToImproveSource: 'generated',
        rendered: true,
        // Unchanged from the previous emitter's observed value: it computed `Boolean(onRetryPoints || onNewSet)`
        // and `SessionPage` passes both unconditionally (`:735`, `:744`), so this was always true. The Open Mic
        // next action is the verdict card's own always-rendered `Practice this again` control.
        nextActionPersisted: true,
        suppressionReason: 'none',
      });
      // #1259 F16 — rendering may not be claimed for a review the user has not reached. Readiness is marked
      // separately below, when the validated review becomes available.
      markCompletionStage('review_rendered');
      observer?.disconnect();
    };

    if (typeof IntersectionObserver === 'undefined') {
      const rect = card.getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < window.innerHeight) publishVisibleReview();
      return;
    }

    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.target === card && entry.isIntersecting && entry.intersectionRatio > 0)) {
        publishVisibleReview();
      }
    }, { threshold: 0.01 });
    observer.observe(card);
    return () => observer?.disconnect();
  }, [sessionId, suggestions]);

  /**
   * #1466 Codex P1 (PM RETURN) — READINESS IS NOT RENDERING.
   *
   * `practice_loop_ready` rode inside the intersection callback, so a valid review that arrived below the fold
   * was not "ready" until the user scrolled to it — the scroll time was charged to generation, and the render
   * interval (`practice_loop_ready` → `review_rendered`) collapsed to zero. The completion chain exists to keep
   * those two latencies apart. A validated 1+1 review is ready the moment `suggestions` holds it; only the
   * rendered receipt and `review_rendered` wait for the user to see it. Same guard as the receipt: loading,
   * empty, invalid, failed and superseded states leave `suggestions` null and never reach this line.
   */
  const readyMarkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId || !suggestions || readyMarkedRef.current === sessionId) return;
    readyMarkedRef.current = sessionId;
    markCompletionStage('practice_loop_ready');
  }, [sessionId, suggestions]);

  // #1466 — no forced scroll. The review is visible because `SessionOverhaulView` places it first, above the
  // session shell, in every state. Scrolling to it only ever helped the success case and could push the
  // page's saved confirmation out of view.

  // #1416 P2-4 — THE FIRST REQUEST FIRES ITSELF.
  //
  // PO ruling: a click is friction and no contract requires one. `LegalPage` conditions provider
  // processing on a coaching feature being USED, not on a press, and the Gemini line beside the
  // button is a disclosure rather than a consent gate.
  //
  // Gated on `reviewReady`, which is P2-2's authority — retained/finalized transcript truth, not
  // render readiness. That composition is the whole point: an auto-fire on render would send the
  // doomed request P2-2 forbids, automatically, with no click left to stop it. Automating a request
  // that was already wrong makes it worse, not faster.
  //
  // Scoped by `sessionId` exactly as the rendered receipt below already is, so re-renders cannot
  // fire a second time. Nothing re-fires after a failure either — that is what the button is for
  // now, and a self-retrying request against a failing provider is a loop the user cannot escape.
  const autoRequestedRef = useRef<string | null>(null);

  /** #1473 — the single scheduled automatic retry, so leaving the page or starting a new lifecycle can cancel it. */
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * #1486 Codex P1 — LEAVING IS A MOUNT FACT, NOT A GENERATION BUMP.
   *
   * This cleanup used to do `requestGenerationRef.current += 1`, and that is wrong under the `StrictMode`
   * wrapper `main.tsx` applies in development and test builds. StrictMode replays effects as
   * setup -> cleanup -> setup, so the cleanup ran immediately after the first mount. The bump marked the
   * one automatic request stale, while `autoRequestedRef` still recorded the session — so the replayed
   * setup returned early instead of starting a replacement, and the successful response was discarded
   * against a generation that no longer matched. The review card stayed empty for every developer and
   * every test that renders this component the way the app does.
   *
   * A mounted flag is the honest expression of what the guard actually needs to know. StrictMode's replay
   * sets it back to true, so the in-flight request survives a replay it was never meant to be cancelled by.
   * A real unmount leaves it false forever, which is what #1473 wanted: nothing fires, reports or renders
   * after the user has moved on. Session transitions keep invalidating by generation, above, where a
   * transition genuinely is a new lifecycle.
   */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  const fetchSuggestions = useCallback(async () => {
    if (!reviewReady || !sessionId) return;
    const requestSessionId = sessionId;
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    const isCurrentRequest = () =>
      mountedRef.current
      && activeSessionRef.current === requestSessionId
      && requestGenerationRef.current === requestGeneration;

    trackPracticeLoopReviewRequested();

    /**
     * #1473 — ONE BOUNDED LIFECYCLE PER REQUEST (the automatic first request, or one manual press).
     *
     * At most two attempts. A TERMINAL failure (service configuration, access, quota, not found, no transcript, an
     * invalid response) ends the lifecycle at once: another attempt cannot change it, and a self-retrying request
     * against it is a loop the user cannot escape. A RECOVERABLE failure (network, provider/5xx) gets exactly one
     * automatic retry after a bounded backoff; while it waits, the failure stays visible and no attempt is claimed
     * to be active. Exhaustion is terminal. Exactly one terminal outcome is reported per lifecycle.
     *
     * #1422 — A SUPERSEDED REQUEST REPORTS NOTHING AND RENDERS NOTHING: every outcome is checked against the current
     * request first, so a late answer for session A never counts or shows after the user moved to session B.
     */
    let pendingWaits = 0;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      setView({ sessionId: requestSessionId, suggestions: null, isLoading: true, error: null, retrying: false });
      let failure: SafeSuggestionError;
      try {
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error("Supabase client not available");
        const { data, error: invokeError } = await supabase.functions.invoke('get-ai-suggestions', {
          // The edge function loads transcript and measurements from this authenticated saved session.
          // Never send caller-owned evidence that could be swapped between session ids.
          body: { sessionId: sessionId || null, ...(product ? { product } : {}) },
        });

        if (invokeError) {
          throw invokeError;
        }

        // The function itself might return an error in its body
        if (data?.error) {
          throw new Error(data.error);
        }

        const persistedSuggestions = parseAISuggestions(data?.suggestions);
        if (persistedSuggestions) {
          if (isCurrentRequest()) {
            // Success from this endpoint means the exact result was persisted and read back server-side.
            trackPracticeLoopReviewCompleted();
            trackPracticeLoopReviewPersisted();
            setView({ sessionId: requestSessionId, suggestions: persistedSuggestions, isLoading: false, error: null, retrying: false });
          }
          return;
        }
        failure = { reason: 'invalid_response', message: UNAVAILABLE_MESSAGE };
      } catch (err: unknown) {
        // #1258 — Focus Points results not saved yet: nothing was spent, so wait and ask again (still "coming",
        // never an error), without consuming a lifecycle attempt. Bounded by FOCUS_RESULTS_PENDING_WAITS.
        if (errorStatus(err) === 425 && pendingWaits < FOCUS_RESULTS_PENDING_WAITS) {
          pendingWaits += 1;
          if (!isCurrentRequest()) return;
          const proceed = await new Promise<boolean>((resolve) => {
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null;
              resolve(isCurrentRequest());
            }, retryBackoffMs);
          });
          if (!proceed) return;
          attempt -= 1;
          continue;
        }
        logger.error({ err }, "Error fetching AI suggestions:");
        failure = getSafeAiSuggestionError(err, await readClosedCode(err));
      }

      if (!isCurrentRequest()) return;

      if (attempt === 1 && !TERMINAL_REASONS.has(failure.reason)) {
        setView({ sessionId: requestSessionId, suggestions: null, isLoading: false, error: failure.message, retrying: true });
        const proceed = await new Promise<boolean>((resolve) => {
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            resolve(isCurrentRequest());
          }, retryBackoffMs);
        });
        if (!proceed) return;
        continue;
      }

      trackPracticeLoopReviewFailed(failure.reason);
      setView({ sessionId: requestSessionId, suggestions: null, isLoading: false, error: failure.message, retrying: false });
      return;
    }
  }, [reviewReady, sessionId, retryBackoffMs, product]);

  useEffect(() => {
    if (!reviewReady || !sessionId) return;
    if (autoRequestedRef.current === sessionId) return;
    // A session that already carries a stored review needs no request at all.
    if (suggestions) { autoRequestedRef.current = sessionId; return; }
    if (isLoading || error) return;
    autoRequestedRef.current = sessionId;
    void fetchSuggestions();
  }, [reviewReady, sessionId, suggestions, isLoading, error, fetchSuggestions]);

  /**
   * #1422 — ONE SETTLED/UNSETTLED SIGNAL, published where the journey can read it.
   *
   * `loading` is the only state that is still in motion. Everything else is an answer the user can act
   * on, including `error`: a malformed review response is a real outcome, and the card says so rather
   * than spinning. The E2E lane needs this because "the review settled honestly" and "the review is
   * still loading" are otherwise indistinguishable from outside, and the previous test worked around
   * that by asserting fabricated verdict prose that was always present.
   */
  // #1473 — a scheduled automatic retry is still in motion, so it reads as `loading` to the journey lane.
  const reviewState = (isLoading || retrying) ? 'loading' : (error ? 'error' : (suggestions ? 'ready' : 'empty'));

  /**
   * S-12 / S-14 — slot B's content, on the ink ground the shell owns. It carries no card chrome of its
   * own: a white card inside an ink band is the "everything blends" failure the palette change fixed.
   *
   * **The slot is built to grow (S-12b).** The verdict — one 24–26px observation with its consequence —
   * belongs ABOVE the coaching pair, and it does not exist yet: the persisted contract carries
   * `what_worked` and `what_to_try_next` and no verdict, no quotes and no offsets. So the verdict slot is
   * deliberately empty today and the pair is NOT the card's headline element. When the coaching contract
   * gains a verdict plus quote offsets, S-12 is a content addition here, not a re-layout.
   *
   * **The guard is verdict ⇒ quotes, not quotes ⇒ card** (Designer correction, 17 Sep). A synthesised
   * claim about someone's speech needs their words attached, so a verdict may never render without its
   * evidence. The shipped pair is a different kind of statement — qualitative, per-session, asserting no
   * pattern — so it needs no quote-level proof, and gating it behind quotes would delete working coaching
   * to satisfy a rule about something it is not. With no verdict, the guard is vacuously satisfied.
   *
   * **There is no dead end and no spinner where the verdict goes (S-14).** The old card showed
   * `Review unavailable` over an empty box with a Retry button, which made a recoverable network blip
   * look like a lost session. The review is a network call; the counts are not — they are computed on
   * device from the transcript — so while the review is still coming, the counts fill the space and the
   * chip is the only progress indicator. `Practice this again` lives directly beneath this card and stays
   * primary and enabled throughout: the loop runs without the review.
   */
  /**
   * TWO failure shapes, because only one of them is still coming (#1422 / #1473).
   *
   * `inFlight` — a request is running, or a RECOVERABLE failure is showing with its one automatic retry
   * scheduled. "Coaching is still coming" is true here, and the chip is the only progress indicator.
   *
   * `terminal` — the lifecycle has ENDED (service configuration, access, quota, not found, no transcript,
   * an invalid response, or exhaustion). Another attempt cannot change it, so claiming coaching is on its
   * way would be a false promise, and a RETRYING chip would be a lie. The server-classified copy carries
   * what actually happened, in product language — the raw provider prose never reaches the user — and the
   * on-device counts still fill the space, so this is not the dead end S-14 deletes either.
   */
  const inFlight = isLoading || retrying;
  const terminal = Boolean(error) && !retrying && !isLoading;
  const stillComing = inFlight || terminal;
  const publishedCounts = React.useContext(OnDeviceCountsContext);
  const counts = onDeviceCounts ?? publishedCounts;
  const hasCounts = counts != null
    && (typeof counts.fillers === 'number' || typeof counts.wordsPerMinute === 'number');

  return (
    <div
      ref={reviewCardRef}
      data-testid="ai-suggestions-card"
      data-review-state={reviewState}
      /*
       * STRUCTURAL observables for the lifecycle rules, so the suite never has to assert on a log line or a
       * button label. `data-retry-scheduled` is the single automatic retry of a recoverable failure waiting
       * out its backoff; `data-lifecycle` distinguishes a pending lifecycle from one that has ENDED, which
       * is the branch that decides whether the RETRYING chip may appear at all.
       */
      data-retry-scheduled={retrying ? 'true' : 'false'}
      data-lifecycle={inFlight ? 'pending' : terminal ? 'terminal' : suggestions ? 'complete' : 'idle'}
      className="min-w-0"
    >
      <div className="mb-4 flex items-center justify-between gap-3.5">
        {/* A real heading at the eyebrow's visual size: it names the review section for screen-reader
            navigation and parents the "What went well" / "Try this next run" h4s. */}
        <h3 className="inline-flex items-center gap-2 text-[12px] font-extrabold uppercase tracking-[0.09em] text-signature">
          <Sparkles className="h-[15px] w-[15px]" aria-hidden="true" />
          Practice Loop review
        </h3>
        {inFlight ? (
          /* The chip replaces the session meta — the one progress indicator the user needs. Retry is
             silent and backed off; no error code, no spinner, no disabled primary action. It appears ONLY
             while something really is in flight or scheduled. */
          <span
            className="inline-flex shrink-0 items-center gap-[7px] text-[12px] font-extrabold text-signature"
            data-testid="ai-suggestions-retrying"
          >
            <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-signature" />
            RETRYING
          </span>
        ) : (
          sessionLabel && (
            <span className="shrink-0 text-[12px] font-bold text-ink-muted" data-testid="ai-suggestions-session-label">
              {sessionLabel}
            </span>
          )
        )}
      </div>

      {/* ── verdict slot (S-12, awaiting the contract that carries a verdict + quote offsets) ── */}

      {stillComing && (
        <div data-testid="ai-suggestions-still-coming">
          <h4
            className="max-w-[560px] text-[24px] font-extrabold leading-[1.3] tracking-[-0.03em] text-ink-text"
            data-testid="ai-suggestions-headline"
          >
            {inFlight
              ? 'Coaching is still coming. Here\u2019s what we counted on your device in the meantime.'
              : error}
          </h4>
          <p className="mt-2 max-w-[520px] text-[14px] font-semibold leading-relaxed text-ink-muted">
            {inFlight
              ? 'Nothing is lost \u2014 your session is saved and the review will appear here when it lands.'
              : 'Your session is saved, and these counts came from your device \u2014 they never needed the review.'}
          </p>
          {/* Two counts, and only counts that exist. A third appears here ONLY when a third metric is
              genuinely measured on device — never stubbed, zeroed or em-dashed. */}
          {hasCounts && (
            <div className="mt-5 flex flex-wrap gap-6 rounded-xl bg-ink-raised px-5 py-[18px]" data-testid="on-device-counts">
              {typeof counts!.fillers === 'number' && (
                <div>
                  <p className="text-[30px] font-extrabold leading-none tracking-[-0.03em] text-signature [font-variant-numeric:tabular-nums]" data-testid="on-device-fillers">
                    {counts!.fillers}
                  </p>
                  <p className="mt-[5px] text-[13px] font-bold text-ink-muted">fillers</p>
                </div>
              )}
              {typeof counts!.wordsPerMinute === 'number' && (
                <div>
                  <p className="text-[30px] font-extrabold leading-none tracking-[-0.03em] text-ink-text [font-variant-numeric:tabular-nums]" data-testid="on-device-pace">
                    {Math.round(counts!.wordsPerMinute)}
                  </p>
                  <p className="mt-[5px] text-[13px] font-bold text-ink-muted">words / min</p>
                </div>
              )}
            </div>
          )}
          {(error || retrying) && (
            <button
              type="button"
              onClick={() => { void fetchSuggestions(); }}
              disabled={isLoading || retrying || !reviewReady}
              className="mt-4 text-[14px] font-bold text-ink-muted underline-offset-2 hover:underline disabled:no-underline disabled:opacity-60"
              data-testid="ai-suggestions-retry"
            >
              Retry review now
            </button>
          )}
        </div>
      )}

      {!stillComing && suggestions && (
        <div className="flex flex-col gap-3" data-testid="ai-suggestions-pair">
          <div className="rounded-xl bg-ink-raised px-[15px] py-3">
            {/* Headings, not styled paragraphs: the pair is two labelled sections, and the live Practice
                Loop journey locates each by its heading role before reading the sentence beneath it. */}
            <h4 className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-muted">What went well</h4>
            <p className="mt-1.5 text-[15px] font-semibold leading-snug text-ink-text">{suggestions.what_worked}</p>
          </div>
          {/* The fix, in the signature block S-12 reserves for it — the one imperative sentence. */}
          <div className="rounded-xl bg-signature px-5 py-[18px]">
            <h4 className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-signature-text">Try this next run</h4>
            <p className="mt-1.5 text-[16px] font-extrabold leading-[1.48] text-ink">{suggestions.what_to_try_next}</p>
          </div>
        </div>
      )}

      {!stillComing && !suggestions && !reviewReady && (
        <p className="text-[15px] font-semibold text-ink-muted" data-testid={blockedReason ? 'practice-loop-review-blocked' : 'practice-loop-review-not-ready'}>
          {blockedReason ? blockedReason : sessionId
            ? 'A review needs a completed session with a saved transcript.'
            : 'Your review will be available after this session finishes saving.'}
        </p>
      )}

      {!stillComing && !suggestions && reviewReady && (
        <p className="text-[15px] font-semibold text-ink-muted" data-testid="ai-suggestions-idle">
          Your review is on its way.
        </p>
      )}

      {/*
        Persistent provider disclosure: visible before AND after generation (including when suggestions
        are prefilled), so the user can always see where this session's transcript goes.

        #1416 P2-4 — THIS MATTERS MORE NOW THAT THE SEND IS AUTOMATIC. A user must not learn their
        transcript went to Google from text attached to a button they never touched, so it sits in the card
        body, in the same region as the review and its progress state. It is a statement, not a gate.
      */}
      <p className="mt-4 text-[12px] font-medium text-ink-muted" data-testid="ai-suggestions-disclosure">
        Sends this session's transcript to Google Gemini to create AI coaching. Audio is never sent.
      </p>
    </div>
  );
};

export default AISuggestions;
