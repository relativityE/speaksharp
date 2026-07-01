import React, { ReactNode, ErrorInfo } from 'react';
import * as Sentry from '@sentry/react';
import logger from '../lib/logger';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
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
