import { getSupabaseClient } from './supabaseClient';
import logger from './logger';
import type { PracticeSession } from '../types/session';
import type { UserProfile } from '../types/user';
import type { PostgrestError } from '@supabase/supabase-js';
import type { AnalyticsSummary } from '../types/analytics';

/**
 * Pagination options for session history queries.
 */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

const MAX_TRANSCRIPT_LENGTH = 500000; // ~500KB limit for transcript text

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
    const { data, error }: { data: PracticeSession[] | null, error: PostgrestError | null } = await supabase
      .from('sessions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    logger.info({ sessionCount: data?.length || 0 }, '[Supabase DB] ✅ Sessions fetched');

    if (error) {
      logger.error({ error }, `Error fetching session history from ${requestUrl}:`);
      throw new Error(`Failed to fetch sessions from ${requestUrl}: ${error.message}`);
    }
    return data || [];
  } catch (fetchError) {
    const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
    logger.error({ error: fetchError, requestUrl }, '[getSessionHistory] Failed to fetch sessions');
    // Re-throw with descriptive message including the URL
    throw new Error(`Failed to fetch sessions from ${requestUrl}: ${errorMessage}`);
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
    const { data, error }: { data: PracticeSession | null, error: PostgrestError | null } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null;
      }
      logger.error({ error }, `Error fetching session by ID ${sessionId}:`);
      throw new Error(`Failed to fetch session ${sessionId}: ${error.message}`);
    }
    return data;
  } catch (fetchError) {
    logger.error({ error: fetchError, sessionId }, '[getSessionById] Failed');
    throw new Error(`Failed to fetch session ${sessionId}: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
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
): Promise<{ session: PracticeSession | null, usageExceeded: boolean }> => {
  const supabase = getSupabaseClient();
  if (!sessionData || !sessionData.user_id) {
    logger.error('Save Session: Session data and user ID are required.');
    return { session: null, usageExceeded: false };
  }

  // Security: Enforce input length limits
  if (sessionData.transcript && sessionData.transcript.length > MAX_TRANSCRIPT_LENGTH) {
    logger.warn({ userId: sessionData.user_id, length: sessionData.transcript.length }, 'Session save blocked: Transcript exceeds max length.');
    throw new Error(`Transcript too long (Max ${MAX_TRANSCRIPT_LENGTH} chars). Please contact support.`);
  }

  logger.info({ userId: sessionData.user_id, duration: sessionData.duration, engineType, idempotencyKey }, '[Supabase DB] 💾 Saving session via RPC');
  const { data, error } = await supabase.rpc('create_session_and_update_usage', {
    p_session_data: sessionData,
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

/**
 * Marks a session as completed or failed with final metrics.
 */
export const completeSession = async (
  sessionId: string,
  options: {
    status?: 'completed' | 'failed';
    transcript?: string;
    duration?: number;
    reason?: string;
  } = {}
): Promise<{ success: boolean }> => {
  const supabase = getSupabaseClient();
  const { status = 'completed', transcript, duration } = options;

  // 1. Run the existing finalization logic via RPC (Finalizes durations/usage)
  const { data, error } = await supabase.rpc('complete_session', {
    p_session_id: sessionId,
    p_status: status,
    p_final_transcript: transcript,
    p_final_duration: duration,
    p_reason: options.reason
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
      .eq('user_id', userId);

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
