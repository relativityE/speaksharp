// RATIONALE: Using esm.sh for Deno imports ensures explicit versioning and avoids 
// dependency on local node_modules, which is standard practice for Supabase Edge Functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.4";

console.info("create_user function starting");

/**
 * Performs a constant-time comparison of two strings to prevent timing attacks.
 * @param {string} a - The first string to compare.
 * @param {string} b - The second string to compare.
 * @returns {boolean} True if the strings match exactly.
 */
function safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}

/**
 * Supabase Edge Function to provision an E2E test user and their profile.
 * 
 * IMPLEMENTATION: "2-Stage Key" Synchronized Auth
 * - Stage 1 (Gateway): Requires 'apikey' header (Project ANON key) for routing.
 * - Stage 2 (Function): Requires 'Authorization: Bearer <AGENT_SECRET>' for logic access.
 * 
 * PRE-REQUISITE: Must be deployed with verify_jwt = false.
 */
Deno.serve(async (req: Request) => {
    try {
        if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

        const body = await req.json().catch(() => null);
        if (!body) return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });

        // Flexible field extraction (handles aliases from different client versions)
        const email = body.email || body.username;
        const password = body.password;
        const subscription_status = body.subscription_status || body.type;

        // Agent Auth Extraction (2nd Stage Verification)
        const authHeader = req.headers.get("Authorization") || "";
        const bearer = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

        // Prefer header bearer token; fallback to body for legacy support
        const providedSecret = bearer || (body && body.agent_secret ? String(body.agent_secret) : null);

        // Verify secret via constant-time comparison
        const EXPECTED_SECRET = Deno.env.get("AGENT_SECRET") || "";
        if (!EXPECTED_SECRET || !providedSecret || !safeCompare(providedSecret, EXPECTED_SECRET)) {
            console.error("Unauthorized: agent_secret mismatch");
            return new Response(JSON.stringify({ error: "unauthorized" }), {
                status: 401,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Defensive: Immediately redact/delete secret from memory objects
        if (body && body.agent_secret) delete body.agent_secret;

        // Basic validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
            return new Response(JSON.stringify({ error: "invalid_email", message: "email/username must be a valid email" }), { status: 400 });
        }

        // Initialize Supabase Admin Client
        const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
        const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY")!;
        if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
            return new Response(JSON.stringify({ error: "server_misconfigured" }), { status: 500 });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false }
        });

        let userId: string;

        // 1. Provision Auth User (if password provided)
        if (password) {
            console.log(`Provisioning Auth user: ${email}`);
            const { data, error } = await supabase.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
            });

            if (error) {
                // Graceful recovery for existing users
                if (error.message?.includes("already registered")) {
                    const { data: listData, error: listError } = await supabase.auth.admin.listUsers();
                    if (listError) throw listError;
                    const existing = listData.users.find((u: any) => u.email === email);
                    if (existing) {
                        userId = existing.id;
                        console.log(`User exists (${userId}), updating password...`);
                        const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
                            password,
                            email_confirm: true
                        });
                        if (updateError) {
                            console.error("Auth update error:", updateError);
                            return new Response(JSON.stringify({ error: "auth_update_failed", details: updateError }), { status: 500 });
                        }
                    } else {
                        return new Response(JSON.stringify({ error: "user_exists_but_lookup_failed" }), { status: 500 });
                    }
                } else {
                    console.error("Auth creation error:", error);
                    return new Response(JSON.stringify({ error: "auth_creation_failed", details: error }), { status: 500 });
                }
            } else {
                userId = data.user.id;
            }
        } else {
            // Profile-only update (requires user to already exist)
            const { data: listData } = await supabase.auth.admin.listUsers();
            const existing = listData.users.find((u: any) => u.email === email);
            if (!existing) {
                return new Response(JSON.stringify({ error: "user_not_found", message: "password required for user creation" }), { status: 400 });
            }
            userId = existing.id;
        }

        // 2. Provision / Upsert Profile (Tier Alignment)
        let tier = 'free';
        let usageLimit = 3600; // 1 hour default

        if (subscription_status === 'pro') {
            tier = 'pro';
            usageLimit = -1; // Unlimited
        }

        console.log(`Upserting profile for ${userId} (status: ${tier})`);
        const { error: profileError } = await supabase
            .from('user_profiles')
            .upsert({
                id: userId,
                user_id: userId,
                subscription_status: tier,
                usage_limit: usageLimit,
            }, { onConflict: 'id' });

        if (profileError) {
            console.error("Profile provision failed:", profileError);
            return new Response(JSON.stringify({ error: "profile_provision_failed", details: profileError }), { status: 500 });
        }

        // 3. Final Success Response
        return new Response(JSON.stringify({
            success: true,
            ok: true,
            user: { id: userId, email: email },
            profile: { tier, limit: usageLimit }
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        console.error("Critical edge function error:", err);
        return new Response(JSON.stringify({ error: "internal_error", message: String(err) }), { status: 500 });
    }
});
