/**
 * #1161 — Private attribution attestation producer (Supabase Edge Function).
 *
 * The SOLE trusted producer of a Private attribution authority. The client can no longer write the locked
 * sessions attribution-identity columns (the migration REVOKEs authenticated UPDATE); instead, on a completed
 * Private recording the client posts the instantiated-engine runtime evidence here. This function:
 *   1. authenticates the caller (JWT) and confirms the caller OWNS the session (RLS-scoped read);
 *   2. issues a server-side challenge and calls the service-role-only attest RPC, which fail-closed validates
 *      the evidence (provider transformers-js[-v4], non-tiny model, no fallback, no Cloud) and, on success,
 *      writes the immutable authority row + the server-owned sessions identity.
 * Fail-closed: any rejection ⇒ no authority, generic 422; the client never writes attribution itself.
 *
 * Note: Deno runtime, not Node.js — IDE warnings about `Deno` / npm: imports are expected.
 */
import { corsGuard, corsHeaders } from "../_shared/cors.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type ClientFactory = (authHeader: string) => SupabaseClient;
type ServiceClientFactory = () => SupabaseClient;
type EnvGetter = (key: string) => string | undefined;

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
  _getEnv: EnvGetter = (key) => Deno.env.get(key) ?? undefined,
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

    // 2. Parse + validate the request body.
    let payload: { sessionId?: unknown; runtimeEvidence?: unknown };
    try {
      payload = await req.json();
    } catch {
      return json(req, 400, { error: "Invalid JSON body" });
    }
    const sessionId = payload.sessionId;
    const runtimeEvidence = payload.runtimeEvidence;
    if (typeof sessionId !== "string" || !UUID_RE.test(sessionId)) {
      return json(req, 400, { error: "sessionId must be a UUID" });
    }
    if (runtimeEvidence === null || typeof runtimeEvidence !== "object" || Array.isArray(runtimeEvidence)) {
      return json(req, 400, { error: "runtimeEvidence must be an object" });
    }

    // 3. Ownership: the RLS-scoped read returns the row ONLY if the caller owns it.
    const { data: owned, error: ownErr } = await userClient
      .from("sessions").select("id").eq("id", sessionId).maybeSingle();
    if (ownErr) return json(req, 500, { error: "Ownership check failed" });
    if (!owned) return json(req, 403, { error: "Not your session" });

    // 4. Service-role: issue the challenge, then attest. The RPC is the fail-closed evidence gate + sole writer.
    const service = createServiceClient();
    const { data: challengeId, error: challengeErr } = await service
      .rpc("issue_attribution_challenge_v1", { p_session_id: sessionId });
    if (challengeErr || !challengeId) return json(req, 500, { error: "Could not begin attestation" });

    const { data: version, error: attestErr } = await service
      .rpc("attest_session_engine_v1", {
        p_session_id: sessionId,
        p_challenge_id: challengeId,
        p_runtime_evidence: runtimeEvidence,
      });
    if (attestErr || !version) {
      // Fail-closed: evidence rejected (Browser/Cloud/fallback/tiny/malformed) ⇒ no authority. Generic message.
      console.warn("attest rejected", { reason: attestErr?.message ?? "no version returned" });
      return json(req, 422, { error: "Attestation rejected", attributed: false });
    }
    return json(req, 200, { attributed: true, authority_version: version });
  } catch (e) {
    console.error("attest-session-engine error", { message: (e as Error)?.message });
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
