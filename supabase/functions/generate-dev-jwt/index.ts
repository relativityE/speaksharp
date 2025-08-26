import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-dev-secret-key, X-Dev-Secret-Key',
};

export async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const devSecretHeader = req.headers.get('X-Dev-Secret-Key');
    const devSecretKey = Deno.env.get("DEV_SECRET_KEY")?.trim();
    const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET")?.trim();

    if (!devSecretKey || !jwtSecret) {
      console.error('[generate-dev-jwt] Server configuration error: DEV_SECRET_KEY or SUPABASE_JWT_SECRET is not set.');
      return new Response(JSON.stringify({ error: 'Server configuration error.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    if (devSecretHeader !== devSecretKey) {
      console.error('[generate-dev-jwt] Unauthorized: Invalid developer key provided.');
      return new Response(JSON.stringify({ error: 'Invalid developer key.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(jwtSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
    );

    const devUserId = Deno.env.get("UUID_DEV_USER")?.trim();
    if (!devUserId) {
      console.error('[generate-dev-jwt] Server configuration error: UUID_DEV_USER is not set.');
      return new Response(JSON.stringify({ error: 'Server configuration error: Dev user UUID not set.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const payload = {
      iss: "speaksharp-dev",
      sub: devUserId,
      role: "authenticated",
      exp: getNumericDate(60 * 60), // Expires in 1 hour
    };

    const jwt = await create({ alg: "HS256", typ: "JWT" }, payload, key);

    return new Response(JSON.stringify({ token: jwt }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    const message = (error instanceof Error) ? error.message : 'An unexpected error occurred.';
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500
    });
  }
}

serve((req: Request) => {
    return handler(req);
});
