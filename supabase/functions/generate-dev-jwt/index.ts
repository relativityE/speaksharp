// File: functions/generate-dev-jwt/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import * as jose from 'https://esm.sh/jose@4.15.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

export async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // This function is now a simple JWT generator and doesn't need a dev key.
    // The browser can call it directly in dev mode.
    // It's secured by the fact that it only returns a token for a non-privileged, specific dev user UUID.

    // Environment variables
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const uuidDevUser = Deno.env.get('UUID_DEV_USER');

    if (!serviceRoleKey || !uuidDevUser) {
      throw new Error('Missing required environment variables');
    }

    // Create short-lived JWT (expires in 10 min)
    const jwt = await new jose.SignJWT({ sub: uuidDevUser, role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode(serviceRoleKey));

    return new Response(JSON.stringify({ token: jwt, expires_in: 600 }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 200
    });

  } catch (err) {
    const message = (err instanceof Error) ? err.message : 'An unexpected error occurred.';
    return new Response(JSON.stringify({ error: message }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 500
    });
  }
}

// Start server if the script is executed directly.
if (import.meta.main) {
  serve(handler);
}
