
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import logger from '@/lib/logger';
import * as Sentry from '@sentry/react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    onReset?: () => void;
    /** Logical key for Sentry isolation (e.g. 'live-transcript') */
    isolationKey?: string;
    /** Human readable name for the component being wrapped */
    componentName?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * A reusable Error Boundary that catches React render errors, logs them to Sentry
 * with isolation context, and displays a user-friendly fallback UI.
 */
export class LocalErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        // 1. Structured Logging (Local/Dev)
        logger.error({
            err: error,
            component: this.props.componentName || 'Unknown',
            isolationKey: this.props.isolationKey,
            info: errorInfo
        }, '[LocalErrorBoundary] Caught error');

        // 2. Sentry Reporting (Production)
        Sentry.withScope((scope) => {
            if (this.props.isolationKey) {
                scope.setTag('errorBoundary', this.props.isolationKey);
            }
            if (this.props.componentName) {
                scope.setTag('component', this.props.componentName);
            }

            // [Fix: Missing Component Stack Context]
            // Sentry automatic integration captures some context, but explicit 
            // setContext ensures high-fidelity debugging for isolated UI zones.
            scope.setContext('react', {
                componentStack: errorInfo.componentStack,
            });

            Sentry.captureException(error);
        });
    }

    private handleReset = () => {
        this.setState({ hasError: false, error: null });
        this.props.onReset?.();
    };

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="p-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-900/30">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                        <div className="flex-1 space-y-2">
                            <h3 className="font-medium text-red-900 dark:text-red-200">
                                {this.props.componentName ? `${this.props.componentName} Error` : 'Something went wrong'}
                            </h3>
                            <p className="text-sm text-red-800 dark:text-red-300">
                                {this.state.error?.message || 'An unexpected error occurred.'}
                            </p>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={this.handleReset}
                                className="mt-2 text-red-700 border-red-200 hover:bg-red-100 dark:text-red-300 dark:border-red-800 dark:hover:bg-red-900/30"
                            >
                                <RefreshCw className="mr-2 h-3 w-3" />
                                Try Again
                            </Button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
