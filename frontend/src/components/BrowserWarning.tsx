import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Alert } from '@/components/ui/alert';

interface BrowserWarningProps {
  isSupported: boolean;
  supportError: string | null;
}

/**
 * #1323/#1184: the trailing "use the latest version of Chrome or Edge" was removed. It was inherited
 * from the retired Web Speech engine, which really was Chromium-only. Private STT is WebAssembly and
 * runs anywhere WASM does, so naming two browsers told users a false thing about where the product
 * works. `supportError` from useBrowserSupport already names the specific missing capability.
 */
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
          {reason}
        </p>
      </div>
    </Alert>
  );
};
