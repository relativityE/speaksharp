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

    let { data, error } = await runQuery(SESSION_ANALYSIS_SELECT);
    // Pre-migration only: retry WITHOUT transcript_state on the specific missing-column error.
    if (error && isMissingTranscriptStateColumn(error)) {
      logger.warn('[Supabase DB] transcript_state not yet applied — retrying legacy select (pre-migration)');
      ({ data, error } = await runQuery(SESSION_ANALYSIS_SELECT_LEGACY));
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
  // NOTE: `finalTranscript` is DELIBERATELY ABSENT until the atomic-completion migration is applied. The RPC
  // parameter `p_final_transcript` exists only on that migration; sending it to a database without it makes
  // PostgREST fail to resolve the function (PGRST202) and EVERY completion fail — which is exactly what turned
  // all four e2e shards red (SESSION_COMPLETION_FAILED). The client adopts the parameter in the same increment
  // that follows migration application, never before it.
}

/**
 * Marks a session completed or failed. ONE server-side transaction persists the transcript, every retained
 * metric, the filler snapshot, the one structured next action, the duration and the status together, then runs
 * newest-two retention before commit — so "completed but missing its metrics" is not a reachable state.
 * Strictly idempotent server-side: an identical replay is a no-op, any mismatch conflicts rather than
 * partially writing.
 *
 * DEPLOY ORDER. The atomic RPC's `p_final_transcript` parameter is NOT sent yet — see CompleteSessionOptions.
 * The migration must be applied before this client can adopt it.
 */
export const completeSession = async (
  sessionId: string,
  options: CompleteSessionOptions = {}
): Promise<{ success: boolean }> => {
  const supabase = getSupabaseClient();
  const { status = 'completed', duration, reason, nextActionSignal, metrics } = options;

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

  // 1. Atomic, transcript-free finalization via RPC (writes every retained metric + the next action).
  const { data, error } = await supabase.rpc('complete_session', {
    p_session_id: sessionId,
    p_status: status,
    p_final_duration: duration,
    p_reason: reason,
    p_next_action: nextActionSignal ?? null,
    p_total_words: metrics?.totalWords ?? null,
    p_clarity_score: metrics?.clarityScore ?? null,
    p_wpm: metrics?.wpm ?? null,
    p_filler_counts: metrics?.fillerCounts ?? null,
    p_pause_metrics: metrics?.pauseMetrics ?? null,
  });

  if (error) {
    logger.error({ error, sessionId }, '[Supabase DB] 🏁 Session completion RPC failed');
    return { success: false };
  }

  // 2. Explicitly set the status if it's 'failed' (Defense in depth)
  if (status === 'failed') {
      await updateSession(sessionId, { status: 'failed' });
  }

  const result = data as { success: boolean } | null;
  return { success: !!result?.success };
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
