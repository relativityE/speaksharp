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
        {/* Deliberately NOT a heading (#1487 P2). This alert renders wherever a page needs it, including
            before that page's h1, so any heading level here corrupts the document outline: on the signed-out
            homepage an h5 made the outline start at level 5 and then jump backwards to the hero h1. The
            wrapping Alert already carries role="alert", so screen readers still announce the whole region;
            the bold line is a label, not a section. */}
        <p className="font-bold">Browser Compatibility</p>
        <p className="text-sm">
          {reason}
        </p>
      </div>
    </Alert>
  );
};
