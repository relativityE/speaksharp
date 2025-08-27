// File: functions/assemblyai-token/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { AssemblyAI } from 'https://esm.sh/assemblyai@4.15.0';
import * as jose from 'https://esm.sh/jose@4.15.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

export async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), { status: 401, headers: corsHeaders });
    }

    const token = authHeader.replace('Bearer ', '');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const uuidDevUser = Deno.env.get('UUID_DEV_USER');
    const assemblyAIKey = Deno.env.get('ASSEMBLYAI_API_KEY');

    if (!serviceRoleKey || !uuidDevUser || !assemblyAIKey) {
      throw new Error('Missing environment variables');
    }

    // Verify dev JWT
    const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(serviceRoleKey));

    // For a real user, we would check their subscription status here.
    // For the dev user, we check their UUID and grant access.
    if (payload.sub !== uuidDevUser) {
      // This is a valid JWT, but not for the dev user.
      // Here you could add logic to handle real users, e.g., check their subscription in the database.
      // For now, we only allow the dev user.
      return new Response(JSON.stringify({ error: 'Invalid user for this endpoint' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        status: 403 // Forbidden
      });
    }

    // Create AssemblyAI client and temporary token
    const assemblyai = new AssemblyAI({ apiKey: assemblyAIKey });
    const tempToken = await assemblyai.realtime.createTemporaryToken({ expires_in: 600 });

    return new Response(JSON.stringify({ token: tempToken, expires_in: 600 }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 200
    });

  } catch (err) {
    // Catch JWT errors (e.g., signature invalid, expired)
    console.error("Error in assemblyai-token handler:", err);
    const message = (err instanceof Error) ? err.message : 'An unexpected error occurred.';
    return new Response(JSON.stringify({ error: message }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 401
    });
  }
}

// Start server if the script is executed directly.
if (import.meta.main) {
  serve(handler);
}
