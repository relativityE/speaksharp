/**
 * #1046 G2 — Focus Points source-recording registration (Supabase Edge Function).
 *
 * The server-controlled "stamp" that marks a finished Private recording as eligible to be scored as a
 * Focus Points session. `objective_start_session_v1` REQUIRES this stamp (it raises otherwise), and the
 * underlying `objective_register_source_v1` RPC is service-role-only so a browser can never self-stamp.
 * This function is that trusted seam: the client calls it, and it stamps through the service role.
 *
 * HONEST SCOPE (matches the corrected note on objective_start_session_v1): this proves the recording is
 * (a) the CALLER'S OWN (RLS-scoped ownership read) and (b) verified-Private (checked inside the RPC). It
 * does NOT prove the recording was made "in Focus Points mode" — there is no such column on `sessions`,
 * and no server-verifiable objective/Open-Floor signal exists today. The Open-Floor-vs-Focus-Points
 * separation therefore rests on DISCIPLINE: the client invokes this ONLY from the genuine Focus Points
 * flow (after the user has set focus points, on the recording they just made for it). The practical
 * stakes are low and self-affecting — the only party who could mis-stamp their own Open Floor recording
 * is the user, degrading only their own practice data (not a privacy or other-user risk). If we ever want
 * this airtight, add a recording-level "mode" marker and verify it here — a follow-up, not a launch gate.
 *
 * Fail-closed: any rejection ⇒ no stamp, generic status; the client never writes eligibility itself.
 *
 * Note: Deno runtime, not Node.js — IDE warnings about `Deno` / npm: imports are expected.
 */
import { corsGuard, corsHeaders } from "../_shared/cors.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type ClientFactory = (authHeader: string) => SupabaseClient;
type ServiceClientFactory = () => SupabaseClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(req: Request, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
}

export async function handler(
  req: Request,
  createUserClient: ClientFactory,
  createServiceClient: ServiceClientFactory,
): Promise<Response> {
  // Exact-origin CORS guard BEFORE any auth, env read, or DB access.
  const corsRejection = corsGuard(req);
  if (corsRejection) return corsRejection;

  try {
    // 1. Authenticate the caller.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(req, 401, { error: "Missing Authorization header" });
    const userClient = createUserClient(authHeader);
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json(req, 401, { error: "Unauthorized" });

    // 2. Validate the recording id.
    let payload: { sessionId?: unknown };
    try {
      payload = await req.json();
    } catch {
      return json(req, 400, { error: "Invalid JSON body" });
    }
    const sessionId = payload.sessionId;
    if (typeof sessionId !== "string" || !UUID_RE.test(sessionId)) {
      return json(req, 400, { error: "sessionId must be a UUID" });
    }

    // 3. Only an objective-capable user may stamp — the same server-derived gate the RPCs enforce, checked
    //    here so an ineligible caller is rejected before we reach the service role.
    const { data: capable, error: capErr } = await userClient.rpc("has_objective_capability");
    if (capErr) return json(req, 500, { error: "Capability check failed" });
    if (capable !== true) return json(req, 403, { error: "Focus Points is not available on this account" });

    // 4. Confirm the caller OWNS this recording via an RLS-scoped read. This is the check register_source
    //    itself does NOT make (it derives owner from the row), so it must live here: a user may only stamp
    //    their OWN recording, never someone else's id.
    const { data: owned, error: ownErr } = await userClient
      .from("sessions").select("id").eq("id", sessionId).maybeSingle();
    if (ownErr) return json(req, 500, { error: "Ownership check failed" });
    if (!owned) return json(req, 403, { error: "Not your recording" });

    // 5. Stamp it through the service role. The RPC fail-closed validates verified-Private + attribution and
    //    is idempotent (ON CONFLICT DO NOTHING) — a repeat stamp is a no-op success.
    const service = createServiceClient();
    const { data: registered, error: regErr } = await service
      .rpc("objective_register_source_v1", { p_source_session_id: sessionId });
    if (regErr || !registered) {
      // Most commonly: the recording is not verified-Private (an Open Floor / Browser / unverified take).
      console.warn("register-source rejected", { reason: regErr?.message ?? "no id returned" });
      return json(req, 422, { error: "Recording is not eligible for Focus Points", registered: false });
    }

    return json(req, 200, { registered: true });
  } catch (e) {
    console.error("objective-register-source error", { message: (e as Error)?.message });
    return json(req, 500, { error: "Internal server error" });
  }
}

if (import.meta.main) {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.serve((req: Request) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(req) },
      });
    }
    return handler(
      req,
      (authHeader) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      }),
      () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    );
  });
}
