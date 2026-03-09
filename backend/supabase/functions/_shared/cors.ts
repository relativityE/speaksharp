/**
 * CORS Headers for Edge Functions
 * 
 * ⚠️ IDE LINT NOTE: "Cannot find name 'Deno'" is a FALSE POSITIVE.
 * This file runs in Supabase Edge Functions (Deno runtime), not Node.js.
 * The `Deno` global is available at runtime. Do not attempt to "fix" this.
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
 * CONFIGURATION:
 * - Production: ALLOWED_ORIGIN env var set in Supabase Dashboard (e.g., https://speaksharp.vercel.app)
 * - Development: Falls back to localhost:5173 (matches scripts/build.config.js PORTS.DEV)
 */

// Port configuration for local development fallback (sync with scripts/build.config.js)
const DEV_PORT = 5173;

// Read from environment, default to localhost for development
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN");
const FALLBACK_ORIGIN = `http://localhost:${DEV_PORT}`;

export const corsHeaders = (req?: Request) => {
  const origin = req?.headers.get("Origin");

  // If origin matches ALLOWED_ORIGIN exactly, return it.
  // This is the most secure path for production.
  if (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    };
  }

  // 🧪 DEVELOPMENT/PREVIEW MODE
  // Allow localhost and Vercel previews if ALLOWED_ORIGIN is not set or is permissive
  const isPermissive = !ALLOWED_ORIGIN || ALLOWED_ORIGIN === "*";

  if (origin && isPermissive) {
    // Allow localhost
    if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
      return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      };
    }
    // Allow Vercel Deployments
    if (origin.endsWith(".vercel.app")) {
      return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      };
    }
  }

  // Final fallback
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN ?? FALLBACK_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
};
