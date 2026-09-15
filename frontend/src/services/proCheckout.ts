import { getSupabaseClient } from '@/lib/supabaseClient';
import { buildCheckoutBody, trackCheckoutStarted, type ConversionSource } from '@/services/conversionFunnel';

/**
 * The ONE Pro checkout path. Every surface that offers paid continuation (the Pricing page, the landing pricing
 * section) starts checkout through here, so the governed `checkout_started` event, the Edge Function contract and
 * the redirect cannot drift between surfaces. Callers own the payments-enabled gate and user-facing error copy.
 */
export async function startProCheckout(source: ConversionSource): Promise<void> {
    trackCheckoutStarted({ source, plan: 'pro' });

    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available');

    const { data, error } = await supabase.functions.invoke('stripe-checkout', {
        body: buildCheckoutBody('pro', source),
    });

    if (error) throw error;
    if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
    }
    throw new Error('No checkout URL returned');
}
