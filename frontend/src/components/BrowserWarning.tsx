import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Alert } from '@/components/ui/alert';

interface BrowserWarningProps {
  isSupported: boolean;
  supportError: string | null;
}

export const BrowserWarning: React.FC<BrowserWarningProps> = ({ isSupported, supportError }) => {
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
          {reason} For Browser transcription, use the latest version of Chrome or Edge when available.
        </p>
      </div>
    </Alert>
  );
};
