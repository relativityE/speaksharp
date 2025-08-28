// For production, you should specify a list of allowed origins
// and check against `req.headers.get("Origin")`.
// Example:
// const allowedOrigins = [Deno.env.get("FRONTEND_URL"), "http://localhost:5173"];
// const origin = req.headers.get("Origin")!;
// if (allowedOrigins.includes(origin)) { ... }

export const corsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin") || "*";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
};
