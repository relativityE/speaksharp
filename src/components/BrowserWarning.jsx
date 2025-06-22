import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export const BrowserWarning = ({ isSupported }) => {
  if (isSupported) {
    return null;
  }

  return (
    <Alert variant="destructive" className="mb-8">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Browser Not Fully Supported</AlertTitle>
      <AlertDescription>
        Your browser has limited support for the speech recognition technology used by SpeakSharp.
        For the best experience, we recommend using the latest version of Google Chrome.
      </AlertDescription>
    </Alert>
  );
};
