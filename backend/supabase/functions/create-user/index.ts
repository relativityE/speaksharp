// RATIONALE: Using esm.sh for Deno imports ensures explicit versioning and avoids 
// dependency on local node_modules, which is standard practice for Supabase Edge Functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.4";
console.info("create_user function starting");

Deno.serve(async (req: Request) => {
    try {
        if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

        const body = await req.json().catch(() => null);
        if (!body) return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });

        const { username, password, agent_secret, type } = body;

        // Basic validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!username || !emailRegex.test(username)) {
            return new Response(JSON.stringify({ error: "invalid_username", message: "username must be a valid email" }), { status: 400 });
        }
        if (!password || typeof password !== "string" || password.length <= 6 || !/^[A-Za-z0-9]+$/.test(password)) {
            return new Response(JSON.stringify({ error: "invalid_password", message: "password must be >6 chars and alphanumeric" }), { status: 400 });
        }
        // Agent auth (Validation)
        const AGENT_SECRET = Deno.env.get("AGENT_SECRET");
        if (!AGENT_SECRET || agent_secret !== AGENT_SECRET) {
            return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
        }

        // Use service key to call Admin API
        const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
        const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY")!;
        if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
            return new Response(JSON.stringify({ error: "server_misconfigured" }), { status: 500 });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        });

        // Create user via Admin API
        const { data, error } = await supabase.auth.admin.createUser({
            email: username,
            password,
            email_confirm: true,
        });

        if (error) {
            console.error("User creation failed:", error);
            return new Response(JSON.stringify({ error: "create_failed", details: error }), { status: 500 });
        }

        if (!data || !data.user) {
            return new Response(JSON.stringify({ error: "create_failed", details: "No data returned" }), { status: 500 });
        }

        // Create Profile Logic
        const userId = data.user.id;
        let subscriptionStatus = 'free';
        let usageLimit = 3600; // 1 hour default

        if (type === 'pro') {
            subscriptionStatus = 'pro';
            usageLimit = -1; // Unlimited
        }

        const { error: profileError } = await supabase
            .from('user_profiles')
            .insert({
                user_id: userId,
                subscription_status: subscriptionStatus,
                usage_limit: usageLimit,
                // Add other default fields if necessary
            });

        if (profileError) {
            console.error("Profile creation failed:", profileError);
            // Note: User is created but profile failed. Should we delete user?
            // For E2E, returning 500 is probably fine to fail the test.
            return new Response(JSON.stringify({ error: "profile_creation_failed", details: profileError }), { status: 500 });
        }



        // Return user info (avoid returning sensitive tokens in production)
        return new Response(JSON.stringify({ ok: true, user: { id: data.user?.id, email: data.user?.email } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        console.error(err);
        return new Response(JSON.stringify({ error: "internal_error" }), { status: 500 });
    }
});
