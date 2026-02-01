import { useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import React from 'react';

/**
 * Hook to handle Stripe checkout redirect notifications.
 * Encapsulates duplication prevention logic (strict mode safe).
 */
export function useCheckoutNotifications() {
    const location = useLocation();
    const navigate = useNavigate();
    const lastToastId = useRef<string | null>(null);

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const checkoutStatus = params.get('checkout');

        // Create a unique key for this specific toast event to prevent duplicates in StrictMode
        const currentToastId = checkoutStatus ? `${checkoutStatus}-${location.search}` : null;

        if (checkoutStatus && lastToastId.current !== currentToastId) {
            lastToastId.current = currentToastId;

            console.log(`[useCheckoutNotifications] 🔔 Triggering checkout toast: ${checkoutStatus}`);

            if (checkoutStatus === 'success') {
                toast.success('Welcome to Pro!', {
                    description: 'Your account has been upgraded successfully.',
                    icon: React.createElement(CheckCircle2, { className: "h-5 w-5 text-secondary-foreground" }),
                    duration: 8000,
                });
            } else if (checkoutStatus === 'cancelled') {
                toast.error("Payment couldn't be processed", {
                    description: "You're on the Free plan - click 'Upgrade to Pro' anytime to try again.",
                    icon: React.createElement(AlertCircle, { className: "h-5 w-5 text-destructive-foreground" }),
                    duration: 8000,
                });
            }

            // Clear the checkout parameter from the URL to prevent double toasts on mount/refresh
            const newParams = new URLSearchParams(location.search);
            newParams.delete('checkout');
            const search = newParams.toString();

            setTimeout(() => {
                navigate({
                    pathname: location.pathname,
                    search: search ? `?${search}` : ''
                }, { replace: true });
            }, 100);
        }
    }, [location.search, location.pathname, navigate]);
}
