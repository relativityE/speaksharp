/**
 * #1161 — Engine-mode declaration recorder (Supabase Edge Function).
 *
 * HONEST SCOPE: this records the engine MODE the client DECLARES before recording and makes it immutable,
 * owner-bound, single-use, and replay-safe. It does NOT prove which engine executed — Private (on-device WASM)
 * and Browser (browser/OS Web Speech, which is EXTERNALLY processed: speech is sent to an external vendor and
 * text returned) both run client-side, and the backend receives no trusted receipt of execution. 'browser' is
 * never an on-device/privacy claim. The client can no longer write the locked sessions attribution columns (the
 * migration REVOKEs authenticated UPDATE); instead it goes through these guarded steps:
 *   1. authenticate the caller (JWT); for bind/attest, confirm the caller OWNS the session (RLS-scoped read);
 *   2. register the pre-session declaration, bind it to the produced session, then on completion call the
 *      service-role-only attest RPC, which fail-closed validates the runtime evidence for CONSISTENCY with the
 *      declaration (provider transformers-js[-v4], non-tiny model, no fallback, no Cloud) and records the
 *      immutable verdict.
 * Fail-closed: any rejection ⇒ no recorded verdict, generic 422; the client never writes attribution itself.
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

    // 2. Parse + validate the request body. `op` selects the guarded step:
    //    'register' (recording START, PRE-SESSION) records the client-declared mode intent keyed on the recording key —
    //               NO session exists yet, so no session is created for a recording that never starts;
    //    'bind'     (post-RECORDING save)          atomically binds that intent to the produced session;
    //    'attest'   (recording STOP)               consumes the bound intent and writes the terminal verdict.
    let payload: {
      op?: unknown; sessionId?: unknown; recordingKey?: unknown; runtimeEvidence?: unknown;
      engineClass?: unknown; expectedModel?: unknown;
    };
    try {
      payload = await req.json();
    } catch {
      return json(req, 400, { error: "Invalid JSON body" });
    }
    const op = payload.op === "register" ? "register" : payload.op === "bind" ? "bind" : "attest";
    const service = createServiceClient();

    // 3a. REGISTER — PRE-SESSION: freeze the immutable engine class/model provenance against the recording key.
    //     Owner is the JWT-authenticated caller (there is no session to check ownership against yet).
    if (op === "register") {
      const recordingKey = payload.recordingKey;
      if (typeof recordingKey !== "string" || recordingKey.trim() === "" || recordingKey.length > 200) {
        return json(req, 400, { error: "recordingKey must be a non-blank string" });
      }
      const engineClass = payload.engineClass;
      if (engineClass !== "private" && engineClass !== "browser") {
        return json(req, 400, { error: "engineClass must be 'private' or 'browser'" });
      }
      const expectedModel = typeof payload.expectedModel === "string" ? payload.expectedModel : null;
      const { data: challengeId, error: regErr } = await service
        .rpc("issue_attribution_intent_v1", {
          p_user_id: user.id, p_recording_key: recordingKey,
          p_engine_class: engineClass, p_expected_model: expectedModel,
        });
      if (regErr || !challengeId) {
        console.warn("register rejected", { reason: regErr?.message ?? "no intent returned" });
        return json(req, 422, { error: "Registration rejected", registered: false });
      }
      return json(req, 200, { registered: true });
    }

    // For 'bind' and 'attest' a session now exists — validate + confirm ownership via the RLS-scoped read.
    const sessionId = payload.sessionId;
    if (typeof sessionId !== "string" || !UUID_RE.test(sessionId)) {
      return json(req, 400, { error: "sessionId must be a UUID" });
    }
    const { data: owned, error: ownErr } = await userClient
      .from("sessions").select("id").eq("id", sessionId).maybeSingle();
    if (ownErr) return json(req, 500, { error: "Ownership check failed" });
    if (!owned) return json(req, 403, { error: "Not your session" });

    // 3b. BIND — atomically attach the pre-session intent to the just-persisted session (only reached once the
    //     recording produced a session). The RPC enforces ownership + expiry + single-bind replay + lifecycle.
    if (op === "bind") {
      const recordingKey = payload.recordingKey;
      if (typeof recordingKey !== "string" || recordingKey.trim() === "" || recordingKey.length > 200) {
        return json(req, 400, { error: "recordingKey must be a non-blank string" });
      }
      const { data: challengeId, error: bindErr } = await service
        .rpc("bind_attribution_intent_v1", { p_session_id: sessionId, p_recording_key: recordingKey });
      if (bindErr) {
        console.warn("bind rejected", { reason: bindErr.message });
        return json(req, 422, { error: "Bind rejected", bound: false });
      }
      // No matching unbound/unexpired intent ⇒ not an error; the session will resolve unattributed at attest.
      return json(req, 200, { bound: Boolean(challengeId) });
    }

    // 3c. ATTEST — consume the bound intent. The RPC is the fail-closed gate + sole writer; it derives the class
    //     from the server intent, so evidence is consistency evidence only.
    const runtimeEvidence = payload.runtimeEvidence;
    if (runtimeEvidence === null || typeof runtimeEvidence !== "object" || Array.isArray(runtimeEvidence)) {
      return json(req, 400, { error: "runtimeEvidence must be an object" });
    }
    const { data: version, error: attestErr } = await service
      .rpc("attest_session_engine_v1", {
        p_session_id: sessionId, p_runtime_evidence: runtimeEvidence,
      });
    if (attestErr) {
      // The only RPC exception is the TRANSIENT terminal-completion gate (session not yet completed) or a real
      // DB error — retryable. A DEFINITIVE no-authority is not an error; it resolves 'unattributed' below.
      console.warn("attest transient failure", { reason: attestErr.message });
      return json(req, 503, { error: "Attestation deferred", attributed: false, resolved: false });
    }
    if (version === "unattributed") {
      // DEFINITIVE, terminal: this completed session will never gain an authority (Cloud/rejected/never-registered).
      return json(req, 200, { attributed: false, resolved: true });
    }
    return json(req, 200, { attributed: true, resolved: true, authority_version: version });
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
