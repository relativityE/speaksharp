/**
 * Session/profile DATABASE repository (Supabase).
 *
 * NOTE ON NAMING: despite the file name, this module is NOT a browser-storage utility — it does not
 * touch localStorage/sessionStorage. It is the client-side repository/adaptor for persisting and
 * reading practice sessions, profiles, and history from the Supabase database. For browser
 * localStorage/sessionStorage wrappers see `safeStorage.ts`.
 *
 * A physical rename to `sessionRepository.ts` is intentionally deferred: this module is imported by
 * actively-edited files (e.g. SpeechRuntimeController) and renaming it now would create avoidable
 * merge conflicts with in-flight feature branches. Rename as a single coordinated step once those
 * branches land. Tracked as a follow-up.
 */
import { getSupabaseClient } from './supabaseClient';
import logger from './logger';
import type { PracticeSession } from '../types/session';
import type { UserProfile } from '../types/user';
import type { AnalyticsSummary } from '../types/analytics';
import type { NextActionSignal } from '../contracts/nextActionSignal';
import { validatePersistedFillerCounts, type PersistedFillerCounts } from '../contracts/fillerCounts';

/**
 * Pagination options for session history queries.
 */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

// #1306 metrics-only: content columns (transcript, ai_suggestions, ground_truth, accuracy, filler_words,
// custom_words) are no longer persisted or selected. Reads use only content-free metrics + the structured
// next action.
const SESSION_ANALYSIS_COLUMNS = [
  'id',
  'user_id',
  'title',
  'duration',
  'total_words',
  'wpm',
  'clarity_score',
  'filler_counts',
  'pause_metrics',
  'next_action_signal',
  'created_at',
  'engine',
  'engine_version',
  'model_name',
  'device_type',
  'status',
  'attribution_status',
  'transcript_state',
];
const SESSION_ANALYSIS_SELECT = SESSION_ANALYSIS_COLUMNS.join(', ');

// #1306 Step 3 — LIST vs DETAIL are deliberately different selects.
//
// The history LIST stays metrics-only. Broadening it to `transcript` would download every retained
// transcript for every row on the dashboard — a bulk content read to render a list that shows none of it,
// and a far larger disclosure surface than the single session a user actually opened.
//
// A single-session DETAIL read may fetch the transcript plus its state, because that is exactly the one
// session the user asked to open. The state must come WITH the text: rendering is gated on the server's
// `transcript_state`, never on whether the text happens to be non-empty.
const SESSION_DETAIL_COLUMNS = [...SESSION_ANALYSIS_COLUMNS, 'transcript'];
const SESSION_DETAIL_SELECT = SESSION_DETAIL_COLUMNS.join(', ');
const SESSION_DETAIL_SELECT_LEGACY = SESSION_DETAIL_COLUMNS.filter(c => c !== 'transcript_state').join(', ');
// #1047 PR-U1 pre-migration compatibility: a main merge can deploy the frontend BEFORE the migration is
// applied manually. During that window PostgREST rejects a select naming `transcript_state`. The legacy
// select omits it so History/Session review still render (as legacy rows with the state absent → derived).
const SESSION_ANALYSIS_SELECT_LEGACY = SESSION_ANALYSIS_COLUMNS.filter(c => c !== 'transcript_state').join(', ');

/**
 * True ONLY for the specific "transcript_state column does not exist / not in schema cache" error, so the
 * legacy-select retry never swallows auth, permission, network, or unrelated query failures.
 */
const isMissingTranscriptStateColumn = (error: { code?: string; message?: string } | null): boolean => {
  if (!error) return false;
  const message = String(error.message ?? '');
  if (!/transcript_state/i.test(message)) return false;
  return error.code === '42703' // Postgres undefined_column
    || error.code === 'PGRST204' // PostgREST: column not found in schema cache
    || /does not exist|schema cache|could not find/i.test(message);
};

/**
 * Fetches the session history for a specific user with optional pagination.
 * @param {string} userId - The ID of the user.
 * @param {PaginationOptions} options - Optional pagination settings.
 * @returns {Promise<Array>} A promise that resolves to an array of session objects.
 */
export const getSessionHistory = async (
  userId: string,
  options: PaginationOptions = {}
): Promise<PracticeSession[]> => {
  const supabase = getSupabaseClient();
  if (!userId) {
    logger.error('Get Session History: User ID is required.');
    return [];
  }

  const { limit = 50, offset = 0 } = options;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const requestUrl = `${supabaseUrl}/rest/v1/sessions`;

  logger.info({ userId: userId.slice(0, 8) + '...' }, '[Supabase DB] 📥 Fetching sessions');
  logger.info({ requestUrl }, '[Supabase DB] Request URL');

  try {
    const runQuery = (select: string) => supabase
      .from('sessions')
      .select(select)
      .eq('user_id', userId)
      .or('status.is.null,status.eq.completed')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    let { data, error } = await runQuery(SESSION_ANALYSIS_SELECT);
    // Pre-migration only: retry WITHOUT transcript_state on the specific missing-column error; any other
    // error (auth/permission/network/unrelated) still surfaces below.
    if (error && isMissingTranscriptStateColumn(error)) {
      logger.warn('[Supabase DB] transcript_state not yet applied — retrying legacy select (pre-migration)');
      ({ data, error } = await runQuery(SESSION_ANALYSIS_SELECT_LEGACY));
    }

    logger.info({ sessionCount: data?.length || 0 }, '[Supabase DB] ✅ Sessions fetched');

    if (error) {
      logger.error({ error }, `Error fetching session history from ${requestUrl}:`);
      throw new Error('Unable to load your session history. Please refresh and try again.');
    }
    return (data || []) as unknown as PracticeSession[];
  } catch (fetchError) {
    logger.error({ error: fetchError, requestUrl }, '[getSessionHistory] Failed to fetch sessions');
    throw new Error('Unable to load your session history. Please refresh and try again.');
  }
};

/**
 * Fetches a single session by its ID.
 * @param {string} sessionId - The ID of the session.
 * @returns {Promise<PracticeSession | null>} A promise that resolves to the session object or null if not found.
 */
export const getSessionById = async (sessionId: string): Promise<PracticeSession | null> => {
  const supabase = getSupabaseClient();
  if (!sessionId) {
    logger.error('Get Session By ID: Session ID is required.');
    return null;
  }

  try {
    const runQuery = (select: string) => supabase
      .from('sessions')
      .select(select)
      .eq('id', sessionId)
      .single();

    let { data, error } = await runQuery(SESSION_DETAIL_SELECT);
    // Pre-migration only: retry WITHOUT transcript_state on the specific missing-column error. Must stay on
    // the DETAIL family — falling back to the list legacy select would silently drop `transcript` and make
    // an opened session look not-captured when the server actually holds it.
    if (error && isMissingTranscriptStateColumn(error)) {
      logger.warn('[Supabase DB] transcript_state not yet applied — retrying legacy select (pre-migration)');
      ({ data, error } = await runQuery(SESSION_DETAIL_SELECT_LEGACY));
    }

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null;
      }
      logger.error({ error }, `Error fetching session by ID ${sessionId}:`);
      throw new Error('Unable to load this session. Please refresh and try again.');
    }
    return data as unknown as PracticeSession | null;
  } catch (fetchError) {
    logger.error({ error: fetchError, sessionId }, '[getSessionById] Failed');
    throw new Error('Unable to load this session. Please refresh and try again.');
  }
};

/**
 * Saves a new session to the database and checks usage limits.
 * This function is now architected to be atomic by using a single RPC call.
 * @param {object} sessionData - The session data to save.
 * @param {object} profile - The user's profile.
 * @param {string} engineType - The transcription engine type used.
 * @param {string} idempotencyKey - Optional unique key for the session.
 * @param {object} metadata - Optional engine/device metadata.
 * @returns {Promise<{session: object|null, usageExceeded: boolean}>}
 */
export const saveSession = async (
  sessionData: Partial<PracticeSession> & { user_id: string },
  profile: UserProfile,
  engineType: string = 'native',
  idempotencyKey?: string,
  metadata?: { engineVersion?: string; modelName?: string; deviceType?: string }
): Promise<{ session: PracticeSession | null, usageExceeded: boolean, usageError?: string }> => {
  const supabase = getSupabaseClient();
  if (!sessionData || !sessionData.user_id) {
    logger.error('Save Session: Session data and user ID are required.');
    return { session: null, usageExceeded: false };
  }

  // Strip every content-bearing field that the retention contract does NOT retain, before it can reach the DB —
  // so a stray prose write is impossible even if a caller passes one via an untyped object.
  //
  // `transcript` is deliberately ABSENT from this list. #1306 stripped it under a "no transcript ever" P0; that
  // was SUPERSEDED by the #1258/#1314 contract, which retains the newest two sessions' transcripts for review
  // and PDF. Re-adding it here would silently reinstate the reverted decision, so it must not be "restored".
  //
  // The rest stay stripped: coaching prose, ground truth, per-session accuracy, custom words, and the
  // loosely-typed legacy `filler_words` blob (superseded by the strict `filler_counts` contract).
  const CONTENT_FIELDS = ['ai_suggestions', 'ground_truth', 'accuracy', 'custom_words', 'filler_words'] as const;
  const contentFreeSessionData = { ...(sessionData as Record<string, unknown>) };
  for (const field of CONTENT_FIELDS) delete contentFreeSessionData[field];

  logger.info({ userId: sessionData.user_id, duration: sessionData.duration, engineType, idempotencyKey }, '[Supabase DB] 💾 Saving session via RPC');
  const { data, error } = await supabase.rpc('create_session_and_update_usage', {
    p_session_data: contentFreeSessionData,
    p_engine_type: engineType,
    p_idempotency_key: idempotencyKey,
    p_engine_version: metadata?.engineVersion,
    p_model_name: metadata?.modelName,
    p_device_type: metadata?.deviceType
  });

  if (error) {
    logger.error({ error }, 'Error during atomic session save and usage update:');
    return { session: null, usageExceeded: false };
  }

  return {
    session: data?.new_session || null,
    usageExceeded: data?.usage_exceeded || false,
    usageError: data?.error,
  };
};

/**
 * Sends a heartbeat to update session usage incrementally and extend expiry.
 */
export const heartbeatSession = async (
  sessionId: string,
  incrementalSeconds: number = 30
): Promise<{ success: boolean; error?: string }> => {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('heartbeat_session', {
    p_session_id: sessionId,
    p_incremental_seconds: incrementalSeconds
  });

  if (error) {
    logger.error({ error, sessionId }, '[Supabase DB] 💓 Heartbeat failed');
    return { success: false, error: error.message };
  }

  const result = data as { success: boolean } | null;
  return { success: !!result?.success };
};

/** Content-free FINAL metrics written atomically at completion. Numbers only — never transcript/prose. */
export interface SessionFinalMetrics {
  totalWords?: number | null;
  clarityScore?: number | null;
  wpm?: number | null;
  fillerCounts?: PersistedFillerCounts | null;
  pauseMetrics?: Record<string, number> | null;
}

/**
 * Options for `completeSession`. Under the #1258/#1314 retention contract a completed session carries its
 * metrics, exactly one next action, AND — for the two newest sessions — the retained transcript, all written by
 * one server-side transaction.
 */
export interface CompleteSessionOptions {
  status?: 'completed' | 'failed';
  duration?: number;
  reason?: string;
  /** REQUIRED for a `completed` session (the DB rejects a completion without one); omit for `failed`. */
  nextActionSignal?: NextActionSignal | null;
  metrics?: SessionFinalMetrics;
  /**
   * The EXACT finalized transcript selected at the recording boundary, for a `completed` session only.
   * Omit (or null) for `failed`/discarded sessions — they must never send transcript text.
   *
   * Adopted only now: `p_final_transcript` exists solely on the atomic-completion migration, which is
   * applied and postflight-verified in production (run 32665289946). Sending it earlier made PostgREST
   * fail to resolve the function (PGRST202) and turned every completion red.
   */
  finalTranscript?: string | null;
}

/**
 * The server's TYPED, mutually exclusive statement about the transcript. Not a boolean: "the write did not
 * throw" is a different claim from "this transcript is retained", and the client must switch exhaustively
 * rather than infer retention from an absent field.
 */
export const TRANSCRIPT_OUTCOMES = ['retained', 'expired', 'not_provided', 'not_captured', 'retention_failed'] as const;
export type TranscriptOutcome = (typeof TRANSCRIPT_OUTCOMES)[number];

/** The closed set the server's transcript_state trigger can write. Absent/unknown is a contract break. */
export const TRANSCRIPT_STATES = ['available', 'expired', 'not_captured'] as const;
export type TranscriptState = (typeof TRANSCRIPT_STATES)[number];

export interface CompleteSessionResult {
  success: boolean;
  /** Present only on success — the server's explicit outcome, never derived client-side. */
  transcriptOutcome?: TranscriptOutcome;
  transcriptState?: TranscriptState;
  transcriptRetained?: boolean;
  idempotent?: boolean;
  finalStatus?: string | null;
}

/**
 * #1306 Step 3 subtask C — the ONE place that decides whether a session's transcript may be shown.
 *
 * The decision is made from the SERVER's `transcript_state`, never from whether text happens to be
 * present. Inferring state from text is what makes "expired" and "we failed to load it" look identical,
 * and it would let a malformed response that carried stale text render it after expiry.
 *
 * Shared by the review surface and the PDF so the two cannot drift: the PDF consumes this resolved view
 * rather than re-deriving anything or refetching.
 */
export type TranscriptView =
  | { kind: 'available'; text: string }
  | { kind: 'expired' }
  | { kind: 'not_captured' }
  /** State says available, but no usable text arrived. Honest gap — never a blank "transcript". */
  | { kind: 'unavailable' };

export function resolveTranscriptView(session: {
  transcript_state?: string | null;
  transcript?: string | null;
} | null | undefined): TranscriptView {
  if (!session) return { kind: 'unavailable' };
  const state = session.transcript_state;

  // Non-available states SUPPRESS text unconditionally. A response that still carries `transcript`
  // while claiming `expired` is malformed; honouring the text would leak content past its retention.
  if (state === 'expired') return { kind: 'expired' };
  if (state === 'not_captured') return { kind: 'not_captured' };

  if (state === 'available') {
    const text = typeof session.transcript === 'string' ? session.transcript.trim() : '';
    // `available` with nothing usable is a gap to report, not an empty transcript to render.
    return text.length > 0 ? { kind: 'available', text } : { kind: 'unavailable' };
  }

  // Unknown/absent state fails closed on DISPLAY — but it must not fail closed on MEANING. Saying
  // "no transcript was captured" when we simply do not know is a false statement to the user, and
  // only the explicit server state `not_captured` licenses that sentence. Anything else is
  // `unavailable`: we could not load it, which is the honest claim.
  return { kind: 'unavailable' };
}

/**
 * Reduce a Supabase error to a NON-CONTENT code. `message`, `details` and `hint` can quote the failing
 * statement — which, for a completion, contains the transcript — so none of them may be logged. Only a
 * short code matching a conservative shape is kept; anything else becomes a fixed label.
 */
function sanitizeRpcErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(code) ? code : 'unspecified';
}

/**
 * Fail-CLOSED validation of the v2 envelope. `success: true` alone is NOT acceptance: a partial, malformed,
 * or absence-only response must be rejected rather than optimistically treated as a completed save. Every
 * field the client acts on has to be explicitly present and of the expected shape.
 */
function parseCompleteSessionV2 (raw: unknown, expectedStatus: string): CompleteSessionResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { success: false };
  const r = raw as Record<string, unknown>;
  // Both flags are required and must be exactly true — not truthy.
  if (r.success !== true || r.session_saved !== true) return { success: false };
  // The typed outcome must be present and known. An unrecognised value means the server contract moved
  // underneath us; treating it as success would be exactly the absence-only pass this design forbids.
  const outcome = r.transcript_outcome;
  if (typeof outcome !== 'string' || !(TRANSCRIPT_OUTCOMES as readonly string[]).includes(outcome)) {
    return { success: false };
  }
  // The transcript STATE must also be one of the deployed closed states. The server's trigger always
  // writes one of these three, so absent/unknown means we are not talking to the contract we verified.
  const state = r.transcript_state;
  if (typeof state !== 'string' || !(TRANSCRIPT_STATES as readonly string[]).includes(state)) {
    return { success: false };
  }
  // `final_status` must be present AND match what this client asked for. A server that completed a
  // DIFFERENT status than requested has not done what we asked, however successful it reports itself.
  if (typeof r.final_status !== 'string' || r.final_status !== expectedStatus) return { success: false };
  // `transcript_retained` must agree with the typed outcome. A disagreement is a corrupt envelope.
  if (typeof r.transcript_retained !== 'boolean') return { success: false };
  if (r.transcript_retained !== (outcome === 'retained')) return { success: false };
  // State/outcome compatibility, where the server contract makes it deterministic. `retention_failed`
  // is deliberately unconstrained here — it may legitimately report whatever state the row already
  // held — but it still had to pass the closed-state and status checks above.
  const REQUIRED_STATE: Partial<Record<TranscriptOutcome, TranscriptState>> = {
    retained: 'available',
    expired: 'expired',
    not_provided: 'not_captured',
    not_captured: 'not_captured',
  };
  const required = REQUIRED_STATE[outcome as TranscriptOutcome];
  if (required !== undefined && state !== required) return { success: false };

  return {
    success: true,
    transcriptOutcome: outcome as TranscriptOutcome,
    transcriptState: state as TranscriptState,
    transcriptRetained: r.transcript_retained,
    idempotent: r.idempotent === true,
    finalStatus: r.final_status,
  };
}

/**
 * Marks a session completed or failed. ONE server-side transaction persists the transcript, every retained
 * metric, the filler snapshot, the one structured next action, the duration and the status together, then runs
 * newest-two retention before commit — so "completed but missing its metrics" is not a reachable state.
 * Strictly idempotent server-side: an identical replay is a no-op, any mismatch conflicts rather than
 * partially writing.
 *
 * DIRECT V2 CUTOVER. This calls `complete_session_v2` and NEVER falls back to either v1 overload — not on
 * error, timeout, PGRST failure, or replay. A fallback would preserve two completion authorities and make
 * "no legacy caller" unprovable. v1 remains granted server-side only for old in-flight clients and release
 * rollback; rollback is a CLIENT release rollback, never a data rollback.
 */
export const completeSession = async (
  sessionId: string,
  options: CompleteSessionOptions = {}
): Promise<CompleteSessionResult> => {
  const supabase = getSupabaseClient();
  const { status = 'completed', duration, reason, nextActionSignal, metrics, finalTranscript } = options;

  // #1306 client persistence boundary: fail CLOSED on an invalid filler map before it can reach the DB. Only
  // approved standard keys with non-negative finite counts are permitted — an unknown/prose key, nested object,
  // array, string, or bad number is rejected here (never silently dropped, never persisted).
  if (metrics?.fillerCounts != null) {
    const v = validatePersistedFillerCounts(metrics.fillerCounts);
    if (!v.ok) {
      // Log only the SANITIZED code — never the offending key/value (which could be smuggled prose).
      logger.error({ sessionId, code: v.code }, '[Supabase DB] 🏁 rejected invalid filler_counts at the persistence boundary');
      return { success: false };
    }
  }

  // A `failed`/discarded session must never carry transcript text to the server. Normalising here — rather
  // than trusting every caller — means one boundary decides it.
  const transcriptArg = status === 'completed' ? (finalTranscript ?? null) : null;

  // ONE atomic server transaction: metrics, the single next action, the eligible transcript, and newest-two
  // retention all commit together. ALL ELEVEN arguments are named explicitly, nulls included — an omitted
  // argument would let PostgREST resolve a DIFFERENT overload than the one that was reviewed and verified.
  const { data, error } = await supabase.rpc('complete_session_v2', {
    p_session_id: sessionId,
    p_status: status,
    p_final_duration: duration ?? null,
    p_reason: reason ?? null,
    p_next_action: nextActionSignal ?? null,
    p_total_words: metrics?.totalWords ?? null,
    p_clarity_score: metrics?.clarityScore ?? null,
    p_wpm: metrics?.wpm ?? null,
    p_filler_counts: metrics?.fillerCounts ?? null,
    p_pause_metrics: metrics?.pauseMetrics ?? null,
    p_final_transcript: transcriptArg,
  });

  if (error) {
    // NO v1 FALLBACK. A retry replays this same v2 call with the same immutable payload; it never downgrades
    // to the legacy overload, which would silently drop the transcript and split the completion authority.
    //
    // CONTENT-FREE FAILURE. The raw error object must never be logged: PostgREST and Postgres echo request
    // material back in `message`/`details`/`hint`, and this request carries the full transcript. A
    // constraint violation or a statement-level error can therefore quote the transcript verbatim into the
    // log. Only an allowlisted, non-content code/status is recorded, and nothing content-bearing is
    // returned to the caller.
    logger.error(
      { sessionId, rpcErrorCode: sanitizeRpcErrorCode(error) },
      '[Supabase DB] 🏁 Session completion RPC failed',
    );
    return { success: false };
  }

  const result = parseCompleteSessionV2(data, status);
  if (!result.success) {
    // Reject a malformed or partial envelope rather than reading it as a save. Log the SHAPE only — the
    // response can carry the next-action signal, and must never be echoed wholesale.
    logger.error(
      { sessionId, receivedType: data === null ? 'null' : typeof data },
      '[Supabase DB] 🏁 Session completion returned an unusable result envelope',
    );
    return { success: false };
  }

  // NO POST-COMPLETION PATCH — not even for 'failed'. The verified v2 transaction already wrote
  // `p_status`, and `final_status` is validated above to equal exactly what this client requested. A
  // second write after an accepted completion would re-create the divergent authority this increment
  // removed, and the "defence in depth" it once provided is now covered by the status assertion itself.
  return result;
};

/**
 * Updates an existing session with rich metrics.
 */
export const updateSession = async (
  sessionId: string,
  sessionData: Partial<PracticeSession>
): Promise<{ success: boolean; error?: string }> => {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('sessions')
    .update(sessionData)
    .eq('id', sessionId);

  if (error) {
    logger.error({ error, sessionId }, '[Supabase DB] Session update failed');
    return { success: false, error: error.message };
  }

  return { success: true };
};

/**
 * Deletes a session from the database.
 * @param {string} sessionId - The ID of the session to delete.
 * @returns {Promise<boolean>} A promise that resolves to true if successful, false otherwise.
 */
export const deleteSession = async (sessionId: string): Promise<boolean> => {
  const supabase = getSupabaseClient();
  if (!sessionId) {
    logger.error('Delete Session: Session ID is required.');
    return false;
  }
  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', sessionId);

  if (error) {
    logger.error({ error }, 'Error deleting session:');
    return false;
  }
  return true;
};

/**
 * Fetches an aggregated analytics summary for a user via Supabase RPC.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<AnalyticsSummary | null>}
 */
export const getAnalyticsSummary = async (userId: string): Promise<AnalyticsSummary | null> => {
  const supabase = getSupabaseClient();
  if (!userId) return null;

  try {
    logger.info({ userId: userId.slice(0, 8) + '...' }, '[Supabase DB] 📊 Fetching analytics summary via RPC');
    const { data, error } = await supabase.rpc('get_analytics_summary', { p_user_id: userId });

    if (error) {
      logger.error({ error }, 'Error calling get_analytics_summary:');
      throw error;
    }

    return data as AnalyticsSummary;
  } catch (err) {
    logger.error({ err }, '[getAnalyticsSummary] Failed');
    return null;
  }
};

/**
 * Server-authoritative practice-streak DTO, returned by the `get_practice_streak` RPC
 * (migration 20260730000000). This is the STORAGE/DOMAIN type — presentation (`homeEvidence.ts`)
 * imports it from here, never the reverse. The COUNT is derived on read from durably saved sessions;
 * it is never a stored counter and never a localStorage guess.
 */
export type PracticeStreak = {
  state: 'active' | 'none' | 'unavailable';
  count: number;
  lastQualifyingDate: string | null;
  timezone: string | null;
};

/** Fail-closed "unavailable" streak — the safe resolved value for a null/invalid tz or a bad response. */
export const STREAK_UNAVAILABLE: PracticeStreak = {
  state: 'unavailable', count: 0, lastQualifyingDate: null, timezone: null,
};

/**
 * Structurally validate an RPC payload into a PracticeStreak, failing CLOSED. A malformed payload is
 * never coerced into a plausible number — it maps to `STREAK_UNAVAILABLE`. Accepted ONLY when:
 *   - `state` is a known value;
 *   - `count` is an INTEGER (no fractional, negative, non-numeric, NaN);
 *   - the state/count pair is CONSISTENT: `active` ⇒ count ≥ 1; `none`/`unavailable` ⇒ count exactly 0.
 * Anything else (active-zero, none-with-positive-count, fractional/negative/non-numeric count) is rejected.
 */
export function toPracticeStreak(raw: unknown): PracticeStreak {
  if (!raw || typeof raw !== 'object') return STREAK_UNAVAILABLE;
  const r = raw as Record<string, unknown>;
  const { state, count } = r;
  if (state !== 'active' && state !== 'none' && state !== 'unavailable') return STREAK_UNAVAILABLE;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return STREAK_UNAVAILABLE;
  if (state === 'active' && count < 1) return STREAK_UNAVAILABLE;      // active MUST be >= 1
  if ((state === 'none' || state === 'unavailable') && count !== 0) return STREAK_UNAVAILABLE; // MUST be 0
  const timezone = typeof r.timezone === 'string' ? r.timezone : null;
  const lastQualifyingDate = typeof r.lastQualifyingDate === 'string' ? r.lastQualifyingDate : null;
  return { state, count, lastQualifyingDate, timezone };
}

/**
 * Server-authoritative practice streak (#1093). Calls the `get_practice_streak` RPC: SECURITY INVOKER,
 * no caller-supplied id — identity is the caller's own `auth.uid()`. Returns a validated PracticeStreak;
 * a server error or a malformed response resolves to `STREAK_UNAVAILABLE` so the Home chip fails closed
 * (an unavailable/invalid result renders NO chip — never a guessed or fabricated streak). The raw error
 * is logged for diagnostics.
 */
export const getPracticeStreak = async (): Promise<PracticeStreak> => {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase.rpc('get_practice_streak');
    if (error) {
      logger.error({ error }, 'Error calling get_practice_streak:'); // preserved for diagnostics
      return STREAK_UNAVAILABLE;
    }
    return toPracticeStreak(data);
  } catch (err) {
    logger.error({ err }, '[getPracticeStreak] Failed');
    return STREAK_UNAVAILABLE;
  }
};

/**
 * Initialize the account-level IANA timezone ONCE from the authenticated browser (#1093). Calls the
 * `set_user_timezone` RPC (scoped SECURITY DEFINER): it writes only while the stored value is NULL, so
 * calling it every load is safe and never changes an established timezone. There is NO UTC fallback —
 * an invalid/absent timezone is left NULL, so the server reports an unavailable streak and the reader
 * hides the chip rather than showing a wrong-day count. Returns the effective stored timezone (or null).
 */
export const setUserTimezone = async (timezone: string): Promise<string | null> => {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase.rpc('set_user_timezone', { p_timezone: timezone });
    if (error) {
      logger.error({ error }, 'Error calling set_user_timezone:');
      return null;
    }
    return (data as string) ?? null;
  } catch (err) {
    logger.error({ err }, '[setUserTimezone] Failed');
    return null;
  }
};

/**
 * Fetches the total count of sessions for a user.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<number>}
 */
export const getSessionCount = async (userId: string): Promise<number> => {
  const supabase = getSupabaseClient();
  if (!userId) return 0;

  try {
    const { count, error } = await supabase
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .or('status.is.null,status.eq.completed');

    if (error) {
      logger.error({ error }, 'Error fetching session count:');
      return 0;
    }
    return count || 0;
  } catch (err) {
    logger.error({ err }, '[getSessionCount] Failed');
    return 0;
  }
};

/**
 * Exports all data for a specific user.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<object>} A promise that resolves to an object containing all user data.
 */
export const exportData = async (userId: string): Promise<{ sessions: PracticeSession[] }> => {
  const sessions = await getSessionHistory(userId);
  // In the future, this could also fetch user profile, settings, etc.
  return {
    sessions,
  };
};
