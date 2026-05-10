import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2"
import { PROMO_DURATION_MINUTES } from "../_shared/constants.ts"
import { corsHeaders } from "../_shared/cors.ts"

const PROMO_RATE_LIMIT_WINDOW_MINUTES = 15;
const PROMO_RATE_LIMIT_MAX_FAILURES = 8;

function getClientIp(req: Request): string {
    const forwardedFor = req.headers.get('x-forwarded-for');
    if (forwardedFor) return forwardedFor.split(',')[0].trim();

    return req.headers.get('cf-connecting-ip')
        || req.headers.get('x-real-ip')
        || 'unknown';
}

async function sha256Hex(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

serve(async (req: Request) => {
    const requestCorsHeaders = corsHeaders(req);

    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: requestCorsHeaders })
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

            // 🔒 SECURITY: Constant-time comparison to prevent timing attacks (Fixes Domain 6)
            const isMatch = (a: string | null, b: string | null): boolean => {
                if (!a || !b || a.length !== b.length) return false;
                let result = 0;
                for (let i = 0; i < a.length; i++) {
                    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
                }
                return result === 0;
            };

            if (!adminSecret || !isMatch(requestSecret, adminSecret)) {
                console.error(`[apply-promo] Unauthorized generation attempt.`);
                return new Response(
                    JSON.stringify({ success: false, error: 'Unauthorized: Admin secret required', code: 'UNAUTHORIZED' }),
                    { status: 401, headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' } }
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
                { status: 200, headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // --- APPLY LOGIC (Default) ---
        const { data: { user }, error: userError } = await authClient.auth.getUser()

        if (userError || !user) {
            console.error('Auth Error:', userError);
            return new Response(
                JSON.stringify({ success: false, error: `Auth Failed: ${userError?.message || 'No User Found'}`, code: 'AUTH_FAILED' }),
                { status: 401, headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const { promoCode } = await req.json()
        const normalizedPromoCode = typeof promoCode === 'string' ? promoCode.trim() : '';

        if (!normalizedPromoCode) {
            return new Response(
                JSON.stringify({ success: false, error: 'Promo code required' }),
                { status: 400, headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const ipHash = await sha256Hex(getClientIp(req));
        const promoCodeHash = await sha256Hex(normalizedPromoCode.toLowerCase());
        const windowStart = new Date(Date.now() - PROMO_RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString();

        const { count: userFailures, error: userLimitError } = await adminClient
            .from('promo_attempts')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('success', false)
            .gte('attempted_at', windowStart);

        if (userLimitError) {
            console.error('[apply-promo] Failed to verify user promo attempt limit:', userLimitError);
            return new Response(
                JSON.stringify({ success: false, error: 'Unable to verify promo attempt limit' }),
                { status: 503, headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const { count: ipFailures, error: ipLimitError } = await adminClient
            .from('promo_attempts')
            .select('id', { count: 'exact', head: true })
            .eq('ip_hash', ipHash)
            .eq('success', false)
            .gte('attempted_at', windowStart);

        if (ipLimitError) {
            console.error('[apply-promo] Failed to verify IP promo attempt limit:', ipLimitError);
            return new Response(
                JSON.stringify({ success: false, error: 'Unable to verify promo attempt limit' }),
                { status: 503, headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        if ((userFailures ?? 0) >= PROMO_RATE_LIMIT_MAX_FAILURES || (ipFailures ?? 0) >= PROMO_RATE_LIMIT_MAX_FAILURES) {
            return new Response(
                JSON.stringify({ success: false, error: 'Too many promo attempts. Please try again later.' }),
                { status: 429, headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // --- ATOMIC REDEMPTION (RPC) ---
        // Mitigation for Database Race Condition
        const { data: result, error: rpcError } = await adminClient.rpc('redeem_promo', {
            p_code: normalizedPromoCode,
            p_user_id: user.id
        });

        if (rpcError) {
            console.error('RPC Error:', rpcError);
            throw rpcError;
        }

        // RPC returns standardized object: { success: boolean, error?: string, message?: string, ... }
        if (!result.success) {
            const { error: attemptInsertError } = await adminClient.from('promo_attempts').insert({
                user_id: user.id,
                ip_hash: ipHash,
                promo_code_hash: promoCodeHash,
                success: false
            });

            if (attemptInsertError) {
                console.error('[apply-promo] Failed to record failed promo attempt:', attemptInsertError);
                return new Response(
                    JSON.stringify({ success: false, error: 'Unable to record promo attempt' }),
                    { status: 503, headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            return new Response(
                JSON.stringify({ success: false, error: result.error }),
                { status: 400, headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const { error: successAttemptInsertError } = await adminClient.from('promo_attempts').insert({
            user_id: user.id,
            ip_hash: ipHash,
            promo_code_hash: promoCodeHash,
            success: true
        });

        if (successAttemptInsertError) {
            console.error('[apply-promo] Failed to record successful promo attempt:', successAttemptInsertError);
        }

        console.log(`[apply-promo] Success: ${result.message} (Is Reuse: ${result.is_reuse})`);

        return new Response(
            JSON.stringify(result),
            { status: 200, headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return new Response(
            JSON.stringify({ success: false, error: msg, code: 'INTERNAL_ERROR' }),
            { status: 500, headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
