import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export const BrowserWarning = ({ isSupported, supportError }) => {
  if (isSupported) {
    return null;
  }

  const reason = supportError || "Your browser may not fully support all features of this application.";

  return (
    <Alert variant="outline" className="mb-8 flex items-start max-w-md mx-auto border-yellow-500/50">
      <AlertTriangle className="h-5 w-5 text-yellow-500 mr-3 mt-1" />
      <div className="flex-grow">
        <AlertTitle className="font-semibold text-yellow-600">Browser Compatibility</AlertTitle>
        <AlertDescription className="text-muted-foreground">
          {reason} For the best experience, we recommend using the latest version of Google Chrome or Firefox.
        </AlertDescription>
      </div>
    </Alert>
  );
};
