import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '../../lib/logger';
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

const getSafeAiSuggestionError = (err: unknown): SafeSuggestionError => {
  const rawMessage = err instanceof Error
    ? err.message
    : (typeof err === 'object' && err !== null && 'message' in err)
      ? String((err as { message?: unknown }).message ?? '')
      : typeof err === 'string'
        ? err
        : '';
  const message = rawMessage.toLowerCase();

  if (message.includes('not on a pro') || message.includes('pro plan') || message.includes('trial has ended') || message.includes('403')) {
    return { reason: 'access_denied', message: 'Your account cannot request a new review right now. Your saved session is unchanged.' };
  }
  if (message.includes('rate') || message.includes('quota') || message.includes('too many')) {
    return { reason: 'rate_limited', message: 'Review requests are temporarily limited. Please try again later.' };
  }
  if (message.includes('network') || message.includes('fetch') || message.includes('connect')) {
    return { reason: 'network', message: 'The review could not connect. Check your connection and try again.' };
  }
  if (message.includes('transcript') || message.includes('409')) {
    return { reason: 'transcript_unavailable', message: 'This saved session does not have a transcript available for review.' };
  }
  if (message.includes('not found') || message.includes('404')) {
    return { reason: 'not_found', message: 'This saved session could not be found. Your other sessions are unchanged.' };
  }

  return { reason: 'unavailable', message: 'The review is unavailable right now. Your session is saved, and you can try again.' };
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

  useEffect(() => {
    if (!sessionId || !suggestions || renderedReceiptRef.current === sessionId) return;
    renderedReceiptRef.current = sessionId;
    trackPracticeLoopReviewRendered();
  }, [sessionId, suggestions]);

  const fetchSuggestions = async () => {
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
        trackPracticeLoopReviewFailed('invalid_response');
        throw Object.assign(new Error('INVALID_REVIEW_RESPONSE'), { telemetryRecorded: true });
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
  };

  return (
    <Card data-testid="ai-suggestions-card">
      <CardHeader className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-500" />
          Practice Loop review
        </CardTitle>
        <Button
          onClick={() => { void fetchSuggestions(); }}
          disabled={isLoading || !reviewReady}
          size="sm"
          className="w-full sm:w-auto"
        >
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isLoading ? 'Creating review...' : error ? 'Retry review' : 'Get my review'}
        </Button>
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
          Persistent provider disclosure: it must stay visible before AND after
          generation (including when suggestions are prefilled), so the user can
          always see where this session's transcript goes.
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
