// Modern Deno serve import - this is the key fix for Root Cause #3
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
});


// Modern serve pattern - replaces the old "export async function handler" pattern
// This is critical for compatibility with current Supabase Edge Runtime
serve(async (req: Request): Promise<Response> => {
  // Add comprehensive logging to help debug invocation issues
  console.log(`🚀 assemblyai-token function invoked: ${req.method} ${req.url}`);
  console.log(`📋 Headers:`, Object.fromEntries(req.headers.entries()));

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    console.log('✅ CORS preflight request handled');
    return new Response('ok', {
      headers: corsHeaders(),
      status: 200
    });
  }

  if (req.method !== 'POST') {
    console.log(`❌ Method not allowed: ${req.method}`);
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      }
    );
  }

  try {
    // Extract and validate JWT from Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized - Missing or invalid Authorization header. Expected: Bearer <jwt>'
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        }
      );
    }

    const jwt = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Initialize Supabase client with service role key for JWT verification
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing required environment variables: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify and decode the JWT
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);

    if (authError || !user) {
      console.error('JWT verification failed:', authError?.message);
      return new Response(
        JSON.stringify({
          error: 'Unauthorized - Invalid or expired JWT',
          details: authError?.message
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        }
      );
    }

    // At this point, we have a verified user
    console.log(`✅ Authenticated request from user: ${user.id} (${user.email || 'no email'})`);

    // Check if AssemblyAI API key is configured
    const assemblyAIKey = Deno.env.get('ASSEMBLYAI_API_KEY');
    if (!assemblyAIKey) {
      console.error('ASSEMBLYAI_API_KEY environment variable not set');
      return new Response(
        JSON.stringify({ error: 'Server configuration error - AssemblyAI key not configured' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        }
      );
    }

    // Generate AssemblyAI token
    const assemblyResponse = await fetch('https://api.assemblyai.com/v2/realtime/token', {
      method: 'POST',
      headers: {
        'Authorization': `${assemblyAIKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expires_in: 3600 // Token valid for 1 hour
      })
    });

    if (!assemblyResponse.ok) {
      const errorText = await assemblyResponse.text();
      console.error('AssemblyAI token generation failed:', errorText);
      return new Response(
        JSON.stringify({
          error: 'Failed to generate AssemblyAI token',
          details: `AssemblyAI API returned ${assemblyResponse.status}`
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        }
      );
    }

    const assemblyData = await assemblyResponse.json();

    // Optional: Log token generation for monitoring/debugging
    console.log(`🎟️ Generated AssemblyAI token for user ${user.id}`);

    // Optional: Store token usage in database for analytics
    try {
      await supabase
        .from('assemblyai_token_usage') // Create this table if you want to track usage
        .insert({
          user_id: user.id,
          token_generated_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString()
        });
    } catch (dbError) {
      // Don't fail the request if logging fails
      console.warn('⚠️ Failed to log token usage:', dbError);
    }

    console.log('🎉 Successfully returning AssemblyAI token');
    return new Response(
      JSON.stringify({
        token: assemblyData.token,
        expires_in: assemblyData.expires_in || 3600,
        user_id: user.id // Optional: return user ID for frontend use
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      }
    );

  } catch (error) {
    console.error('💥 Unexpected error in assemblyai-token function:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      }
    );
  }
}); // End of serve() call - this is critical!
