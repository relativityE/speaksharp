// Edge Function: create-user.ts (Edge Function)
import { createClient } from 'npm:@supabase/supabase-js@2.32.0';
console.info("create_user function starting");

Deno.serve(async (req: Request) => {
    try {
        if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

        const body = await req.json().catch(() => null);
        if (!body) return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });

        const { username, password, agent_secret } = body;

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
            // role: 'authenticated' // optional
        });

        if (error) {
            // If user exists, maybe update password? Or just return error.
            // For this specific test flow "promo-fix-test-1", we might want to Reset.
            if (error.message.includes('already registered')) {
                // Logic to fetch and update password could go here, but user asked for this specific code.
                // I'll stick to the provided code but maybe add a note or minimal handling if implicit.
                // Provided code returns 500 on error.
                return new Response(JSON.stringify({ error: "create_failed", details: error }), { status: 500 });
            }
            return new Response(JSON.stringify({ error: "create_failed", details: error }), { status: 500 });
        }

        if (!data) {
            return new Response(JSON.stringify({ error: "create_failed", details: "No data returned" }), { status: 500 });
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
