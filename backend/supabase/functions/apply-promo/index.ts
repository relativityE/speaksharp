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
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
            { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
        )

        // Get the user from the JWT
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
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

        // Upgrade the user
        const { error: updateError } = await supabaseClient
            .from('user_profiles')
            .update({ subscription_status: 'pro' })
            .eq('id', user.id)

        if (updateError) {
            throw updateError
        }

        return new Response(
            JSON.stringify({ success: true, message: 'Upgraded to Pro!' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
