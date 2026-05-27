import { useRef, useEffect } from 'react';
import logger from '../lib/logger';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from '@/lib/toast';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import React from 'react';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';

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
        const conversionSource = params.get('conversion_source') ?? 'unknown';
        const utmSource = params.get('utm_source') ?? 'unknown';
        const utmMedium = params.get('utm_medium') ?? 'unknown';
        const utmCampaign = params.get('utm_campaign') ?? 'unknown';

        // Create a unique key for this specific toast event to prevent duplicates in StrictMode
        const currentToastId = checkoutStatus ? `${checkoutStatus}-${location.search}` : null;

        if (checkoutStatus && lastToastId.current !== currentToastId) {
            lastToastId.current = currentToastId;

            logger.info({ checkoutStatus }, '[useCheckoutNotifications] 🔔 Triggering checkout toast');
            analyticsBuffer.push(
                checkoutStatus === 'success' ? 'checkout_returned_success' : 'checkout_returned_cancelled',
                {
                    conversion_source: conversionSource,
                    utm_source: utmSource,
                    utm_medium: utmMedium,
                    utm_campaign: utmCampaign,
                },
                checkoutStatus === 'success' ? 'HIGH' : 'LOW'
            );

            if (checkoutStatus === 'success') {
                toast.success('Welcome to Pro!', {
                    description: 'Your account has been upgraded successfully.',
                    icon: React.createElement(CheckCircle2, { className: "h-5 w-5 text-emerald-700" }),
                    duration: 3500,
                });
            } else if (checkoutStatus === 'cancelled') {
                toast.error("Payment couldn't be processed", {
                    description: "You're on the Free plan - click 'Upgrade to Pro' anytime to try again.",
                    icon: React.createElement(AlertCircle, { className: "h-5 w-5 text-red-700" }),
                    duration: 8000,
                });
            }

            // Clear the checkout parameter from the URL to prevent double toasts on mount/refresh
            const newParams = new URLSearchParams(location.search);
            newParams.delete('checkout');
            newParams.delete('conversion_source');
            newParams.delete('utm_source');
            newParams.delete('utm_medium');
            newParams.delete('utm_campaign');
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
