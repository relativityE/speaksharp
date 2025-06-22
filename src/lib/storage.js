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
 * Saves a new session to the database.
 * @param {object} sessionData - The session data to save.
 * @returns {Promise<object|null>} A promise that resolves to the saved session object or null.
 */
export const saveSession = async (sessionData) => {
  if (!sessionData || !sessionData.user_id) {
    console.error('Save Session: Session data and user ID are required.');
    return null;
  }
  const { data, error } = await supabase
    .from('sessions')
    .insert([sessionData])
    .select()
    .single();

  if (error) {
    console.error('Error saving session:', error);
    return null;
  }
  return data;
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
