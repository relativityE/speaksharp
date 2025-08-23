import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

const AISuggestions = ({ transcript }) => {
  const [suggestions, setSuggestions] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchSuggestions = async () => {
    setIsLoading(true);
    setError(null);
    setSuggestions(null);

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('get-ai-suggestions', {
        body: { transcript },
      });

      if (invokeError) {
        throw invokeError;
      }

      // The function itself might return an error in its body
      if (data.error) {
        throw new Error(data.error);
      }

      setSuggestions(data.suggestions);
    } catch (err) {
      console.error("Error fetching AI suggestions:", err);
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-500" />
          AI-Powered Suggestions
        </CardTitle>
        <Button
          onClick={fetchSuggestions}
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
                <p className="ml-2 text-muted-foreground">Analyzing your speech...</p>
            </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!suggestions && !isLoading && !error && (
          <div className="text-center text-muted-foreground py-4">
            <p>Click the button to get AI-powered feedback on your speech.</p>
          </div>
        )}

        {suggestions && (
          <div className="space-y-4">
            <blockquote className="border-l-2 pl-6 italic">
              "{suggestions.summary}"
            </blockquote>
            <div className="space-y-3">
              {suggestions.suggestions.map((item, index) => (
                <div key={index} className="p-3 bg-muted rounded-lg">
                  <h4 className="font-semibold">{item.title}</h4>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
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
