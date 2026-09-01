import { useRef, useEffect } from 'react';
import logger from '../lib/logger';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from '@/lib/toast';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import React from 'react';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import {
    CONVERSION_SOURCES, UTM_SOURCES, UTM_MEDIUMS, UTM_CAMPAIGNS, closeAttribution,
} from '@/services/conversionVocabulary';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Hook to handle Stripe checkout redirect notifications.
 * Encapsulates duplication prevention logic (strict mode safe).
 */
export function useCheckoutNotifications() {
    const location = useLocation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const lastToastId = useRef<string | null>(null);

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const checkoutStatus = params.get('checkout');
        // CLOSED AT THE PRODUCER. These four values arrive on a visitor-controlled URL, so anything we
        // did not emit collapses to `unknown` here rather than being echoed into a governed event.
        // `?? 'unknown'` only defended against a MISSING parameter; a present one was passed through
        // verbatim, which let `?checkout=success&conversion_source=<anything>` write caller text into
        // the funnel. `unknown` is the honest answer: this return could not be attributed.
        const conversionSource = closeAttribution(params.get('conversion_source'), CONVERSION_SOURCES);
        const utmSource = closeAttribution(params.get('utm_source'), UTM_SOURCES);
        const utmMedium = closeAttribution(params.get('utm_medium'), UTM_MEDIUMS);
        const utmCampaign = closeAttribution(params.get('utm_campaign'), UTM_CAMPAIGNS);

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
                void queryClient.invalidateQueries({ queryKey: ['userProfile'] });
                void queryClient.invalidateQueries({ queryKey: ['usageLimit'] });
                toast.success('Payment received', {
                    description: 'We are confirming your plan with Stripe. Pro unlocks after your account updates.',
                    icon: React.createElement(CheckCircle2, { className: "h-5 w-5 text-emerald-700" }),
                    duration: 7000,
                });
            } else if (checkoutStatus === 'cancelled') {
                toast.error('Checkout cancelled', {
                    description: 'No payment was made. You can try again anytime.',
                    icon: React.createElement(AlertCircle, { className: "h-5 w-5 text-red-700" }),
                    duration: 6000,
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
    }, [location.search, location.pathname, navigate, queryClient]);
}
