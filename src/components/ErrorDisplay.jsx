import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

export const ErrorDisplay = ({ error }) => {
  if (!error) {
    return null;
  }

  // The error could be a string or an object with a 'message' property.
  const errorMessage = typeof error === 'string' ? error : error.message;

  return (
    <Alert variant="destructive" className="mb-6 max-w-2xl mx-auto">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>An Error Occurred</AlertTitle>
      <AlertDescription>{errorMessage || 'An unknown error occurred.'}</AlertDescription>
    </Alert>
  );
};
