import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // Client for authenticating the user from their JWT
        const authClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
        )

        // Service role client for database operations (bypasses RLS)
        const adminClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // Get the user from the JWT using auth client
        const { data: { user }, error: authError } = await authClient.auth.getUser()
        if (authError || !user) {
            throw new Error('Unauthorized')
        }

        const { promoCode } = await req.json()
        const ALPHA_SECRET = Deno.env.get('ALPHA_BYPASS_CODE')

        if (!ALPHA_SECRET) {
            console.error('ALPHA_BYPASS_CODE secret is not configured in Supabase');
            return new Response(
                JSON.stringify({ error: 'Promotion system temporarily unavailable' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (promoCode !== ALPHA_SECRET) {
            return new Response(
                JSON.stringify({ error: 'Invalid promo code' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }
        // Promo code is valid - upgrade user to 'pro' tier using admin client (bypasses RLS)
        // Calculate expiry (30 minutes from now)
        const expiryDate = new Date();
        expiryDate.setMinutes(expiryDate.getMinutes() + 30);

        const { error: updateError } = await adminClient
            .from('user_profiles')
            .update({
                subscription_status: 'pro',
                promo_expires_at: expiryDate.toISOString()
            })
            .eq('id', user.id)

        if (updateError) {
            throw updateError
        }

        console.log(`[apply-promo] User ${user.id} upgraded to pro via promo code`);

        return new Response(
            JSON.stringify({
                success: true,
                message: 'Promo code applied! You have 30 minutes of Pro features.',
                proFeatureMinutes: 30
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
