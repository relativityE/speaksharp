import React from 'react';
import { Alert } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

interface ErrorDisplayProps {
  error: string | { message: string } | null | undefined;
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ error }) => {
  if (!error) {
    return null;
  }

  const errorMessage = typeof error === 'string' ? error : error.message;

  return (
    <Alert variant="error" size="md" className="mb-6 max-w-2xl mx-auto">
      <AlertCircle className="h-5 w-5" />
      <div>
        <h5 className="font-bold">An Error Occurred</h5>
        <p className="text-sm">{errorMessage || 'An unknown error occurred.'}</p>
      </div>
    </Alert>
  );
};
