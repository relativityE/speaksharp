import { getSupabaseClient } from './supabaseClient';
import logger from './logger';
import type { PracticeSession } from '../types/session';
import type { UserProfile } from '../types/user';
import type { PostgrestError } from '@supabase/supabase-js';
import { isFree } from '@/constants/subscriptionTiers';

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
 * Saves a new session to the database and checks usage limits for free users.
 * This function is now architected to be atomic by using a single RPC call.
 * @param {object} sessionData - The session data to save.
 * @param {object} profile - The user's profile.
 * @returns {Promise<{session: object|null, usageExceeded: boolean}>} A promise that resolves to an object containing the saved session and a flag for usage limit.
 */
export const saveSession = async (sessionData: Partial<PracticeSession> & { user_id: string }, profile: UserProfile): Promise<{ session: PracticeSession | null, usageExceeded: boolean }> => {
  const supabase = getSupabaseClient();
  if (!sessionData || !sessionData.user_id) {
    logger.error('Save Session: Session data and user ID are required.');
    return { session: null, usageExceeded: false };
  }

  // Security: Enforce input length limits to prevent DB stuffing
  if (sessionData.transcript && sessionData.transcript.length > MAX_TRANSCRIPT_LENGTH) {
    logger.warn({ userId: sessionData.user_id, length: sessionData.transcript.length }, 'Session save blocked: Transcript exceeds max length.');
    throw new Error(`Transcript too long (Max ${MAX_TRANSCRIPT_LENGTH} chars). Please contact support.`);
  }

  // The previous implementation had a race condition where a user could save multiple
  // sessions before the usage check was performed. This has been fixed by delegating
  // the entire operation to a single, atomic RPC function in the database.
  // This function is responsible for both creating the session and updating/checking usage.
  logger.info({ userId: sessionData.user_id, duration: sessionData.duration }, '[Supabase DB] 💾 Saving session via RPC');
  const { data, error } = await supabase.rpc('create_session_and_update_usage', {
    p_session_data: sessionData,
    p_is_free_user: isFree(profile.subscription_status),
  });

  if (error) {
    logger.error({ error }, 'Error during atomic session save and usage update:');
    return { session: null, usageExceeded: false };
  }

  // The RPC returns { new_session: PracticeSession, usage_exceeded: boolean, reason?: string }
  if (!data?.new_session && data?.reason) {
    logger.warn({ reason: data.reason, userId: sessionData.user_id }, '[Supabase DB] ⚠️ Session save rejected by RPC');
  }

  // We adapt this to the client-side expected return type.
  return {
    session: data?.new_session || null,
    usageExceeded: data?.usage_exceeded || false,
  };
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
