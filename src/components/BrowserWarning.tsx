import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Alert } from '@/components/ui/alert';

export const BrowserWarning = ({ isSupported, supportError }) => {
  if (isSupported) {
    return null;
  }

  const reason = supportError || "Your browser may not fully support all features of this application.";

  return (
    <Alert variant="warning" size="md" className="mb-8 max-w-md mx-auto">
      <AlertTriangle className="h-5 w-5" />
      <div>
        <h5 className="font-bold">Browser Compatibility</h5>
        <p className="text-sm">
          {reason} For the best experience, we recommend using the latest version of Google Chrome or Firefox.
        </p>
      </div>
    </Alert>
  );
};
