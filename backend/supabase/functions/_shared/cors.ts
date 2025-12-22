/**
 * CORS Headers for Edge Functions
 * 
 * WHAT IS CROSS-ORIGIN?
 * When your website at "speaksharp.com" makes an API call to "api.speaksharp.com",
 * that's a cross-origin request (different domain). Browsers block these by default
 * for security. CORS headers tell the browser "it's OK, I trust this origin."
 * 
 * WHY RESTRICT IT?
 * With "*" (allow all), a malicious site could make API calls on behalf of your users.
 * Restricting to your domain means only YOUR website can call YOUR API.
 * 
 * TODO: Update ALLOWED_ORIGIN to production domain once deployed (e.g., https://speaksharp.vercel.app)
 */

import { PORTS } from "./build.config.ts";

// Read from environment, default to localhost for development
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? `http://localhost:${PORTS.DEV}`;

export const corsHeaders = () => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
});
