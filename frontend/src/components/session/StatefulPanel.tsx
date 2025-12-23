import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Info } from 'lucide-react';

interface ErrorStatePanelProps {
    error: Error | null;
}

export const InitialStatePanel: React.FC = () => (
    <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center text-muted-foreground">
            <Info className="mx-auto h-12 w-12" />
            <h3 className="mt-4 text-lg font-semibold">Ready to Go</h3>
            <p className="mt-1 text-sm">Click the "Start Session" button to begin recording and transcription.</p>
        </div>
    </div>
);

export const ErrorStatePanel: React.FC<ErrorStatePanelProps> = ({ error }) => (
    <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center text-destructive">
            <AlertTriangle className="mx-auto h-12 w-12" />
            <h3 className="mt-4 text-lg font-semibold">An Error Occurred</h3>
            <p className="mt-1 text-sm max-w-sm mx-auto">{error?.message || 'An unknown error occurred. Please try again.'}</p>
        </div>
    </div>
);

export const LoadingStatePanel: React.FC = () => (
    <div className="space-y-4">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-1/2" />
    </div>
);
