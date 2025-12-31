import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
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

        const url = new URL(req.url);
        const isAdminAction = url.pathname.endsWith('/generate');

        // Initialize Admin Client for DB operations
        const adminClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // --- GENERATION LOGIC ---
        if (isAdminAction) {
            const code = Math.floor(1000000 + Math.random() * 9000000).toString();
            const duration = 30;

            const { data: newPromo, error: createError } = await adminClient
                .from('promo_codes')
                .insert({
                    code,
                    duration_minutes: duration,
                    max_uses: 1,
                    active: true
                })
                .select()
                .single()

            if (createError) throw createError;

            return new Response(
                JSON.stringify(newPromo),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // --- APPLY LOGIC (Default) ---
        const { data: { user }, error: userError } = await authClient.auth.getUser()

        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const { promoCode } = await req.json()

        // 1. Look up the promo code
        const { data: promo, error: promoLookupError } = await adminClient
            .from('promo_codes')
            .select('*')
            .eq('code', promoCode)
            .eq('active', true)
            .single()

        if (promoLookupError || !promo) {
            return new Response(
                JSON.stringify({ success: false, error: 'Invalid or expired promo code' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 2. Check if user already redeemed THIS code
        const { data: redemption, error: redemptionError } = await adminClient
            .from('promo_redemptions')
            .select('*')
            .eq('promo_code_id', promo.id)
            .eq('user_id', user.id)
            .single();

        if (redemption) {
            // User has used this code before. Check if it's still within the window.
            const durationMs = (promo.duration_minutes || 30) * 60 * 1000;
            const redeemedAt = new Date(redemption.redeemed_at).getTime();
            const expiresAt = redeemedAt + durationMs;
            const now = Date.now();

            if (now > expiresAt) {
                return new Response(
                    JSON.stringify({ success: false, error: 'code already used' }), // Expired
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            } else {
                // Active reuse - return success but DO NOT update anything
                const remainingMinutes = Math.ceil((expiresAt - now) / 60000);
                return new Response(
                    JSON.stringify({
                        success: true,
                        message: `Promo active! You have ${remainingMinutes} minutes remaining.`,
                        proFeatureMinutes: remainingMinutes
                    }),
                    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }
        }

        // 3. If NOT redeemed, check global limits
        if (promo.used_count >= promo.max_uses) {
            return new Response(
                JSON.stringify({ success: false, error: 'code already used' }), // Fully converted by others
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (promo.valid_until && new Date(promo.valid_until) < new Date()) {
            return new Response(
                JSON.stringify({ success: false, error: 'Promo code expired' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 4. Register Redemption (Atomic-ish)
        const { error: redemptionInsertError } = await adminClient
            .from('promo_redemptions')
            .insert({
                promo_code_id: promo.id,
                user_id: user.id
            });

        if (redemptionInsertError) {
            throw redemptionInsertError;
        }

        // 5. Increment usage count
        await adminClient
            .from('promo_codes')
            .update({ used_count: promo.used_count + 1 })
            .eq('id', promo.id)

        // 6. Apply the upgrade
        const durationMinutes = promo.duration_minutes || 30
        const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString()

        const { error: updateError } = await adminClient
            .from('user_profiles')
            .update({
                subscription_status: 'pro',
                promo_expires_at: expiresAt
            })
            .eq('id', user.id)

        if (updateError) {
            throw updateError
        }

        console.log(`[apply-promo] User ${user.id} upgraded via code ${promoCode} (expires: ${expiresAt})`);

        return new Response(
            JSON.stringify({
                success: true,
                message: `Promo code applied! You have Pro features for ${durationMinutes} minutes.`,
                proFeatureMinutes: durationMinutes
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return new Response(
            JSON.stringify({ error: msg }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
