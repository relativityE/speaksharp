import { useState, useEffect } from 'react';

/**
 * Industry Standard: Third-Party Script Detection
 * Pattern: Used by Google Analytics, Segment, Intercom
 */
export function detectStripeAvailability(): {
    available: boolean;
    reason: string | null;
} {
    if (typeof window === 'undefined') {
        return { available: false, reason: 'SSR' };
    }

    // Check 1: Script tag exists
    const scriptTag = document.querySelector('script[src*="stripe.com"]');

    if (!scriptTag) {
        return {
            available: false,
            reason: 'Stripe script not loaded'
        };
    }

    // Check 2: Global Stripe object exists
    const win = window as unknown as Window & { Stripe?: unknown };
    if (typeof win.Stripe === 'undefined') {
        return {
            available: false,
            reason: 'Stripe object not available (likely blocked by ad-blocker)'
        };
    }

    return {
        available: true,
        reason: null
    };
}

export function useStripeAvailability() {
    const [status, setStatus] = useState<{
        available: boolean;
        reason: string | null;
    }>({ available: false, reason: 'Checking...' });

    useEffect(() => {
        // Check immediately
        const check = () => {
            const result = detectStripeAvailability();
            setStatus(result);
        };

        // Check after a delay (script might be loading)
        const timer = setTimeout(check, 1000);

        return () => clearTimeout(timer);
    }, []);

    return status;
}
