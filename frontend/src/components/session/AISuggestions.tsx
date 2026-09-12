import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Loader2, Sparkles, AlertTriangle } from 'lucide-react';
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
const getSafeAiSuggestionError = (err: unknown): SafeSuggestionError => {
  if (isTransportFailure(err) && errorStatus(err) === null) {
    return { reason: 'network', message: 'The review could not connect. Check your connection and try again.' };
  }

  switch (errorStatus(err)) {
    // 401 authentication failed · 403 trial has ended — both are "this account may not, right now".
    case 401:
    case 403:
      return { reason: 'access_denied', message: 'Your account cannot request a new review right now. Your saved session is unchanged.' };
    // 429 daily coaching limit reached.
    case 429:
      return { reason: 'rate_limited', message: 'Review requests are temporarily limited. Please try again later.' };
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
      return { reason: 'unavailable', message: 'The review is unavailable right now. Your session is saved, and you can try again.' };
  }
};

const AISuggestions: React.FC<AISuggestionsProps> = ({ transcript = '', canReview, sessionId, initialSuggestions }) => {
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
  }));

  // A route change can reuse this component instance. Render the new session's persisted value
  // immediately and invalidate every request captured for the previous session.
  const currentView = view.sessionId === sessionId
    ? view
    : { sessionId, suggestions: parseAISuggestions(initialSuggestions), isLoading: false, error: null };
  const { suggestions, isLoading, error } = currentView;
  const reviewReady = Boolean(sessionId && (canReview ?? Boolean(transcript.trim())));
  const renderedReceiptRef = useRef<string | null>(null);

  useEffect(() => {
    setView({
      sessionId,
      suggestions: parseAISuggestions(initialSuggestions),
      isLoading: false,
      error: null,
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
   * This component owns the validated result, so it owns the claim. The guard below is the whole contract:
   *
   *   - `suggestions` is non-null only for a result that passed `parseAISuggestions` — exactly one
   *     `what_worked` and one `what_to_try_next`, both non-blank. Loading, empty, invalid and failed
   *     requests leave it null, so none of them reaches this line.
   *   - `suggestions` is read from `currentView`, which is discarded when `sessionId` changes, so a
   *     superseded session cannot publish for the current one.
   *   - `renderedReceiptRef` keys on the session, so a valid review publishes exactly once per session
   *     however often the screen re-renders.
   *
   * Content-free, as before: two counts, booleans and closed enums. No session id, no prose, no provider
   * error text.
   */
  useEffect(() => {
    if (!sessionId || !suggestions || renderedReceiptRef.current === sessionId) return;
    renderedReceiptRef.current = sessionId;
    trackPracticeLoopReviewRendered();
    emitPracticeLoop({
      // The user is looking at the generated review. This is the only phase that can claim that.
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
    // #1259 F16 — the last two links, published where the review actually exists. `practice_loop_ready` is
    // when the review HAS its content; `review_rendered` is when the user can act on it.
    markCompletionStage('practice_loop_ready');
    markCompletionStage('review_rendered');
  }, [sessionId, suggestions]);

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

  const fetchSuggestions = useCallback(async () => {
    if (!reviewReady || !sessionId) return;
    const requestSessionId = sessionId;
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    const isCurrentRequest = () =>
      activeSessionRef.current === requestSessionId
      && requestGenerationRef.current === requestGeneration;

    setView({ sessionId: requestSessionId, suggestions: null, isLoading: true, error: null });
    trackPracticeLoopReviewRequested();

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase client not available");
      const { data, error: invokeError } = await supabase.functions.invoke('get-ai-suggestions', {
        // The edge function loads transcript and measurements from this authenticated saved session.
        // Never send caller-owned evidence that could be swapped between session ids.
        body: { sessionId: sessionId || null },
      });

      if (invokeError) {
        throw invokeError;
      }

      // The function itself might return an error in its body
      if (data?.error) {
        throw new Error(data.error);
      }

      const persistedSuggestions = parseAISuggestions(data?.suggestions);
      if (!persistedSuggestions) {
        /**
         * #1422 — A SUPERSEDED REQUEST REPORTS NOTHING.
         *
         * This emitted before `isCurrentRequest()` was consulted, so a late malformed answer for
         * session A — already discarded by the UI, correctly — still counted as a review failure after
         * the user had moved to session B. The funnel then showed failures nobody experienced, which is
         * the same class of untruth as a silently missing event: a number that cannot be acted on.
         *
         * The throw is unconditional either way; only the REPORTING is scoped. `telemetryRecorded` is
         * set only when something was actually recorded, so the catch below does not double-count and
         * does not fall back to emitting for a request that is no longer current.
         */
        const current = isCurrentRequest();
        if (current) trackPracticeLoopReviewFailed('invalid_response');
        throw Object.assign(new Error('INVALID_REVIEW_RESPONSE'), { telemetryRecorded: current });
      }

      if (isCurrentRequest()) {
        // Success from this endpoint means the exact result was persisted and read back server-side.
        trackPracticeLoopReviewCompleted();
        trackPracticeLoopReviewPersisted();
        setView({ sessionId: requestSessionId, suggestions: persistedSuggestions, isLoading: false, error: null });
      }
    } catch (err: unknown) {
      logger.error({ err }, "Error fetching AI suggestions:");
      if (isCurrentRequest()) {
        const safeError = getSafeAiSuggestionError(err);
        if (!(typeof err === 'object' && err !== null && 'telemetryRecorded' in err)) {
          trackPracticeLoopReviewFailed(safeError.reason);
        }
        setView({
          sessionId: requestSessionId,
          suggestions: null,
          isLoading: false,
          error: safeError.message,
        });
      }
    } finally {
      if (isCurrentRequest()) {
        setView((current) => current.sessionId === requestSessionId
          ? { ...current, isLoading: false }
          : current);
      }
    }
  }, [reviewReady, sessionId]);

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
  const reviewState = isLoading ? 'loading' : (error ? 'error' : (suggestions ? 'ready' : 'empty'));

  return (
    <Card data-testid="ai-suggestions-card" data-review-state={reviewState}>
      <CardHeader className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-500" />
          Practice Loop review
        </CardTitle>
        {/*
          #1416 P2-4 — the control is a RETRY, not a request. The first review arrives on its own, so
          "Get my review" would offer the user something they have already been given.

          #1422 — AND IT IS GONE ONCE THERE IS A REVIEW TO READ.

          It used to read "Refresh review" after a success, which promised something the product cannot
          do. The coaching is generated once and persisted; pressing it re-reads the stored review and
          renders the identical two phrases. The user is invited to improve what they are looking at,
          waits, and receives the same words back — which reads as the feature being broken rather than
          as it working exactly as designed. A control that cannot change its own outcome should not be
          offered.

          It stays for the two states where pressing it CAN change something: after a failure, and
          before any review exists. Nothing about the locked Gemini contract moves — the daily
          generation budget, the two-phrase shape, and cached coaching remaining readable after
          exhaustion are all untouched. This removes an action, not a capability.
        */}
        {(error || !suggestions) && (
          <Button
            onClick={() => { void fetchSuggestions(); }}
            disabled={isLoading || !reviewReady}
            size="sm"
            className="w-full sm:w-auto"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isLoading ? 'Creating review...' : 'Retry review'}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex justify-center items-center py-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="ml-2 font-medium text-foreground/70">Creating your session review...</p>
          </div>
        )}

        {error && (
          <Alert variant="error" size="md">
            <AlertTriangle className="h-5 w-5" />
            <div>
              <h5 className="font-bold">Review unavailable</h5>
              <p className="text-sm">{error}</p>
            </div>
          </Alert>
        )}

        {!suggestions && !isLoading && !error && reviewReady && (
          <div className="py-4 text-center font-medium text-foreground/70">
            <p>Request one session-specific strength and one improvement for your next take.</p>
          </div>
        )}

        {!suggestions && !isLoading && !error && !reviewReady && (
          <div className="py-4 text-center font-medium text-foreground/70" data-testid="practice-loop-review-not-ready">
            <p>{sessionId
              ? 'A review needs a completed session with a saved transcript.'
              : 'Your review will be available after this session finishes saving.'}</p>
          </div>
        )}

        {suggestions && (
          <div className="space-y-4">
            <div className="p-3 bg-muted/60 rounded-lg border border-[hsl(var(--border))]">
              <h4 className="font-semibold">What went well</h4>
              <p className="text-sm font-medium text-foreground/70">{suggestions.what_worked}</p>
            </div>
            <div className="p-3 bg-muted/60 rounded-lg border border-[hsl(var(--border))]">
              <h4 className="font-semibold">What to improve</h4>
              <p className="text-sm font-medium text-foreground/70">{suggestions.what_to_try_next}</p>
            </div>
          </div>
        )}

        {/*
          Persistent provider disclosure: it must stay visible before AND after generation (including
          when suggestions are prefilled), so the user can always see where this session's transcript
          goes.

          #1416 P2-4 — THIS MATTERS MORE NOW THAT THE SEND IS AUTOMATIC. When the request required a
          press, copy sitting beside the button was read at the moment of the decision. With the
          first request firing on its own, a user must not learn their transcript went to Google from
          text attached to a button they never touched. So it is rendered in the card BODY, in the
          same region as the review and the loading state — present wherever the send is happening,
          not only where a press used to be. It is a statement, not a gate: the ruling is that no
          click is required, and adding friction here would reintroduce the thing that was removed.
        */}
        <p
          className="mt-4 text-xs font-medium text-foreground/70"
          data-testid="ai-suggestions-disclosure"
        >
          Sends this session's transcript to Google Gemini to create AI coaching. Audio is never sent.
        </p>
      </CardContent>
    </Card>
  );
};

export default AISuggestions;
