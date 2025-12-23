import React, { ReactNode, ErrorInfo } from 'react';
import logger from '../lib/logger';
import { ErrorDisplay } from './ErrorDisplay';
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
    // You can also log the error to an error reporting service
    logger.error({ error, errorInfo }, "Uncaught error:");
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
                        An unexpected error occurred. Please try refreshing the page.
                    </p>
                    <ErrorDisplay error={this.state.error} />
                    <Button onClick={() => window.location.reload()}>
                        Refresh Page
                    </Button>
                </CardContent>
            </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
