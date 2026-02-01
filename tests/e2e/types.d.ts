// tests/e2e/types.d.ts
// Type declarations for E2E test window properties

import { Session } from '@supabase/supabase-js';

declare global {
    interface Window {
        // E2E test environment flags
        mswReady?: boolean;
        __E2E_MOCK_SESSION__?: boolean;
        __e2eProfileLoaded__?: boolean;
        __e2eBridgeReady__?: boolean;

        // Speech simulation function (from e2e-bridge.ts)
        dispatchMockTranscript?: (text: string, isFinal?: boolean) => void;

        // Supabase test hooks
        __setSupabaseSession?: (session: Session) => Promise<void>;
    }
}

export { };
