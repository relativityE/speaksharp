import { supabase } from './supabaseClient';

/**
 * Fetches the session history for a specific user.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<Array>} A promise that resolves to an array of session objects.
 */
export const getSessionHistory = async (userId) => {
  if (!userId) {
    console.error('Get Session History: User ID is required.');
    return [];
  }
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching session history:', error);
    return [];
  }
  return data;
};

/**
 * Saves a new session to the database and checks usage limits for free users.
 * @param {object} sessionData - The session data to save.
 * @param {object} profile - The user's profile.
 * @returns {Promise<{session: object|null, usageExceeded: boolean}>} A promise that resolves to an object containing the saved session and a flag for usage limit.
 */
export const saveSession = async (sessionData, profile) => {
  if (!sessionData || !sessionData.user_id) {
    console.error('Save Session: Session data and user ID are required.');
    return { session: null, usageExceeded: false };
  }
  const { data, error } = await supabase
    .from('sessions')
    .insert([sessionData])
    .select()
    .single();

  if (error) {
    console.error('Error saving session:', error);
    return { session: null, usageExceeded: false };
  }

  // After saving, check usage for free tier users
  if (profile.subscription_status === 'free') {
    const { data: usageData, error: rpcError } = await supabase.rpc('update_user_usage', {
      user_id: profile.id,
      duration_seconds: sessionData.duration || 0,
    });

    if (rpcError) {
      console.error('Error updating user usage:', rpcError);
      // Proceed even if RPC fails, not a critical failure
    }

    // The RPC function returns `false` if the limit is exceeded.
    if (usageData === false) {
      return { session: data, usageExceeded: true };
    }
  }

  return { session: data, usageExceeded: false };
};

/**
 * Deletes a session from the database.
 * @param {string} sessionId - The ID of the session to delete.
 * @returns {Promise<boolean>} A promise that resolves to true if successful, false otherwise.
 */
export const deleteSession = async (sessionId) => {
  if (!sessionId) {
    console.error('Delete Session: Session ID is required.');
    return false;
  }
  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', sessionId);

  if (error) {
    console.error('Error deleting session:', error);
    return false;
  }
  return true;
};

/**
 * Exports all data for a specific user.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<object>} A promise that resolves to an object containing all user data.
 */
export const exportData = async (userId) => {
  const sessions = await getSessionHistory(userId);
  // In the future, this could also fetch user profile, settings, etc.
  return {
    sessions,
  };
};
