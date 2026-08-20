import React, { ReactNode, ErrorInfo } from 'react';
import * as Sentry from '@sentry/react';
import logger from '../lib/logger';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { isChunkLoadError, recoverFromStaleChunk, isStaleChunkRecoveryInFlight } from '../lib/staleChunkRecovery';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** A React.lazy chunk-load failure from a stale deployment — recover, never show the generic Oops. */
  staleChunk: boolean;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, staleChunk: false };
  }

  static getDerivedStateFromError(error: Error): State {
    // A React.lazy() import that fails on a stale deployment surfaces here too (not only via
    // vite:preloadError) — either as a recognizable module-load message, OR as the downstream
    // "reading 'default'" TypeError while a recovery is already in flight. Treat both as the known
    // deployment condition (render nothing), never a crash.
    return { hasError: true, error, staleChunk: isChunkLoadError(error) || isStaleChunkRecoveryInFlight() };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (isChunkLoadError(error)) {
      // Known stale-deployment condition — recover with a guarded reload (or the recovery UI on repeat).
      // Do NOT Sentry-report it as a crash.
      logger.warn({ error: error?.message }, '[ErrorBoundary] stale-chunk import failure → recovering');
      recoverFromStaleChunk();
      return;
    }
    if (isStaleChunkRecoveryInFlight()) {
      // A recovery reload is already imminent (claimed via vite:preloadError); this is the downstream
      // symptom. Suppress the generic crash path — do not Sentry-report, do not show Oops.
      logger.warn({ error: error?.message }, '[ErrorBoundary] error during in-flight stale-chunk recovery → suppressed');
      return;
    }
    logger.error({ error, errorInfo }, "Uncaught error:");
    // Report to Sentry. Previously this app-level boundary ONLY logged locally, so any crash that
    // reached it (e.g. the Analytics render crash) was invisible to production monitoring and could
    // not be diagnosed without the owner pasting a console stack. Report it, with the component stack.
    Sentry.withScope((scope) => {
      scope.setTag('errorBoundary', 'app-root');
      scope.setContext('react', { componentStack: errorInfo.componentStack });
      Sentry.captureException(error);
    });
  }

  render() {
    // Stale-deployment chunk failure: a guarded reload / recovery UI is in flight — render nothing
    // rather than flashing the generic "Oops" page for this known, self-healing condition.
    if (this.state.staleChunk) {
      return null;
    }
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return (
        <div className="container mx-auto px-4 py-10 flex items-center justify-center min-h-screen">
            <Card className="text-center max-w-lg">
                <CardHeader>
                    <CardTitle className="text-2xl text-destructive">Oops! Something went wrong.</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground mb-4">
                        The page hit a temporary problem. Try again, or go home and reopen the page.
                    </p>
                    <div className="flex items-center justify-center gap-3">
                        <Button onClick={() => window.location.reload()}>
                            Try again
                        </Button>
                        <Button variant="outline" onClick={() => window.location.assign('/')}>
                            Go Home
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
