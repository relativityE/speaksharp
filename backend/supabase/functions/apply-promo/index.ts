import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.2"
import { PROMO_DURATION_MINUTES } from "../_shared/constants.ts"

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
            // PROMO_GEN_ADMIN_SECRET is a highly sensitive key used to 
            // generate single-use promo codes programmatically.
            const adminSecret = Deno.env.get('PROMO_GEN_ADMIN_SECRET');
            const requestSecret = req.headers.get('X-Promo-Admin-Key');

            if (!adminSecret || requestSecret !== adminSecret) {
                console.error(`[apply-promo] Unauthorized generation attempt. Secret Match: ${!!adminSecret && requestSecret === adminSecret}`);
                return new Response(
                    JSON.stringify({ error: 'Unauthorized: Admin secret required' }),
                    { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            const code = Math.floor(1000000 + Math.random() * 9000000).toString();
            const duration = PROMO_DURATION_MINUTES;

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
            console.error('Auth Error:', userError);
            return new Response(
                JSON.stringify({ error: `Auth Failed: ${userError?.message || 'No User Found'}` }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const { promoCode } = await req.json()

        // --- ATOMIC REDEMPTION (RPC) ---
        // Mitigation for Database Race Condition
        const { data: result, error: rpcError } = await adminClient.rpc('redeem_promo', {
            p_code: promoCode,
            p_user_id: user.id
        });

        if (rpcError) {
            console.error('RPC Error:', rpcError);
            throw rpcError;
        }

        // RPC returns standardized object: { success: boolean, error?: string, message?: string, ... }
        if (!result.success) {
            return new Response(
                JSON.stringify({ success: false, error: result.error }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        console.log(`[apply-promo] Success: ${result.message} (Is Reuse: ${result.is_reuse})`);

        return new Response(
            JSON.stringify(result),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return new Response(
            JSON.stringify({ error: msg }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
