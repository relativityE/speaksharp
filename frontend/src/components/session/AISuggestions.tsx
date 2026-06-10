import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '../../lib/logger';

interface SuggestionItem {
  title: string;
  description: string;
}

interface AISuggestionsData {
  summary: string;
  suggestions: SuggestionItem[];
}

interface AISuggestionsProps {
  transcript: string;
  sessionId?: string;
  initialSuggestions?: AISuggestionsData;
  metrics?: {
    wpm?: number;
    clarity_score?: number;
    total_words?: number;
    duration?: number;
    filler_words?: Record<string, { count: number }>;
    pause_metrics?: {
      silencePercentage: number;
      transitionPauses: number;
      extendedPauses: number;
      longestPause: number;
    };
  };
}

const getSafeAiSuggestionError = (err: unknown): string => {
  const rawMessage = err instanceof Error
    ? err.message
    : (typeof err === 'object' && err !== null && 'message' in err)
      ? String((err as { message?: unknown }).message ?? '')
      : typeof err === 'string'
        ? err
        : '';
  const message = rawMessage.toLowerCase();

  if (message.includes('not on a pro') || message.includes('pro plan') || message.includes('403')) {
    return 'AI coaching is a Pro feature. Upgrade to Pro to request semantic suggestions.';
  }
  if (message.includes('rate') || message.includes('quota') || message.includes('too many')) {
    return 'AI coaching is temporarily rate limited. Please try again later.';
  }
  if (message.includes('network') || message.includes('fetch') || message.includes('connect')) {
    return 'AI coaching could not connect. Please check your connection and try again.';
  }

  return 'AI coaching is unavailable right now. Your session is saved, and you can try again later.';
};

const AISuggestions: React.FC<AISuggestionsProps> = ({ transcript, sessionId, initialSuggestions, metrics }) => {
  const [suggestions, setSuggestions] = useState<AISuggestionsData | null>(initialSuggestions || null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSuggestions = async () => {
    setIsLoading(true);
    setError(null);
    setSuggestions(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase client not available");
      const { data, error: invokeError } = await supabase.functions.invoke('get-ai-suggestions', {
        body: {
          transcript,
          metrics: metrics || null,
          sessionId: sessionId || null
        },
      });

      if (invokeError) {
        throw invokeError;
      }

      // The function itself might return an error in its body
      if (data.error) {
        throw new Error(data.error);
      }

      setSuggestions(data.suggestions);
    } catch (err: unknown) {
      logger.error({ err }, "Error fetching AI suggestions:");
      setError(getSafeAiSuggestionError(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card data-testid="ai-suggestions-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-500" />
          AI Coaching Suggestions
        </CardTitle>
        <Button
          onClick={() => { void fetchSuggestions(); }}
          disabled={isLoading || !transcript}
          size="sm"
        >
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isLoading ? 'Analyzing...' : 'Get Suggestions'}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex justify-center items-center py-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="ml-2 font-medium text-foreground/70">Analyzing your speech...</p>
          </div>
        )}

        {error && (
          <Alert variant="error" size="md">
            <AlertTriangle className="h-5 w-5" />
            <div>
              <h5 className="font-bold">AI coaching unavailable</h5>
              <p className="text-sm">{error}</p>
            </div>
          </Alert>
        )}

        {!suggestions && !isLoading && !error && (
          <div className="py-4 text-center font-medium text-foreground/70">
            <p>Click the button to request AI coaching on your speech.</p>
            <p className="mt-2 text-xs">
              Your transcript is securely processed by our AI feedback provider only when you request suggestions.
            </p>
          </div>
        )}

        {suggestions && (
          <div className="space-y-4">
            <blockquote className="border-l-2 pl-6 italic">
              "{suggestions.summary}"
            </blockquote>
            <div className="space-y-3">
              {suggestions.suggestions.map((item, index) => (
                <div key={index} className="p-3 bg-muted/60 rounded-lg border border-[hsl(var(--border))]">
                  <h4 className="font-semibold">{item.title}</h4>
                  <p className="text-sm font-medium text-foreground/70">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AISuggestions;
