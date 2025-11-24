export const corsHeaders = () => ({
  "Access-Control-Allow-Origin": "*", // or "http://localhost:5173"
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
});
