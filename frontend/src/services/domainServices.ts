/**
 * Domain Services Layer
 * 
 * This module centralizes all Supabase database access, providing a clean
 * abstraction between React hooks and the database layer.
 * 
 * Benefits:
 * - Single source of truth for data access patterns
 * - Easier to mock in tests
 * - Consistent error handling via structured logger
 * - Type safety at the boundary
 * 
 * Error Handling:
 * - All errors are logged via the structured Pino logger (captured by Sentry)
 * - 'Not found' cases (PGRST116) are logged at debug level and return null
 * - Other errors are logged at error level and re-thrown
 * 
 * Usage:
 * Instead of calling supabase directly in hooks:
 *   const { data } = await supabase.from('sessions')...
 * 
 * Use the service:
 *   const sessions = await sessionService.getHistory(userId);
 */

import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';
import type { PracticeSession } from '@/types/session';
import type { UserProfile } from '@/types/user';

// Lazy getter to avoid module-load-time errors in tests
const getClient = () => getSupabaseClient();

// ============================================================================
// Session Service
// ============================================================================

export const sessionService = {
    /**
     * Get practice session history for a user
     */
    async getHistory(userId: string, limit = 50): Promise<PracticeSession[]> {
        const supabase = getClient();
        const { data, error } = await supabase
            .from('sessions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            logger.error({ error }, '[sessionService.getHistory]');
            throw error;
        }

        return data as PracticeSession[];
    },

    /**
     * Get a single session by ID
     */
    async getById(sessionId: string): Promise<PracticeSession | null> {
        const supabase = getClient();
        const { data, error } = await supabase
            .from('sessions')
            .select('*')
            .eq('id', sessionId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                logger.debug({ sessionId }, '[sessionService.getById] Session not found');
                return null;
            }
            logger.error({ error, sessionId }, '[sessionService.getById]');
            throw error;
        }

        return data as PracticeSession;
    },

    /**
     * Create a new session
     */
    async create(session: Partial<PracticeSession>): Promise<PracticeSession> {
        const supabase = getClient();
        const { data, error } = await supabase
            .from('sessions')
            .insert(session)
            .select()
            .single();

        if (error) {
            logger.error({ error }, '[sessionService.create]');
            throw error;
        }

        return data as PracticeSession;
    },

    /**
     * Update session
     */
    async update(sessionId: string, updates: Partial<PracticeSession>): Promise<PracticeSession> {
        const supabase = getClient();
        const { data, error } = await supabase
            .from('sessions')
            .update(updates)
            .eq('id', sessionId)
            .select()
            .single();

        if (error) {
            logger.error({ error }, '[sessionService.update]');
            throw error;
        }

        return data as PracticeSession;
    },

    /**
     * Delete session
     */
    async delete(sessionId: string): Promise<void> {
        const supabase = getClient();
        const { error } = await supabase
            .from('sessions')
            .delete()
            .eq('id', sessionId);

        if (error) {
            logger.error({ error }, '[sessionService.delete]');
            throw error;
        }
    },
};

// ============================================================================
// Profile Service
// ============================================================================

export const profileService = {
    /**
     * Get user profile by ID
     */
    async getById(userId: string): Promise<UserProfile | null> {
        const supabase = getClient();
        const { data, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                logger.debug({ userId }, '[profileService.getById] Profile not found');
                return null;
            }
            logger.error({ error, userId }, '[profileService.getById]');
            throw error;
        }

        return data as UserProfile;
    },

    /**
     * Update user profile
     */
    async update(userId: string, updates: Partial<UserProfile>): Promise<UserProfile> {
        const supabase = getClient();
        const { data, error } = await supabase
            .from('user_profiles')
            .update(updates)
            .eq('id', userId)
            .select()
            .single();

        if (error) {
            logger.error({ error }, '[profileService.update]');
            throw error;
        }

        return data as UserProfile;
    },
};

// ============================================================================
// Custom Vocabulary Service
// ============================================================================

export interface CustomWord {
    id: string;
    word: string;
    user_id: string;
    created_at: string;
}

export const vocabularyService = {
    /**
     * Get user's custom vocabulary
     */
    async getWords(userId: string): Promise<CustomWord[]> {
        const supabase = getClient();
        const { data, error } = await supabase
            .from('user_filler_words')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            logger.error({ error }, '[vocabularyService.getWords]');
            throw error;
        }

        return data as CustomWord[];
    },

    /**
     * Add a word to vocabulary
     */
    async addWord(userId: string, word: string): Promise<CustomWord> {
        const supabase = getClient();
        const { data, error } = await supabase
            .from('user_filler_words')
            .insert({ user_id: userId, word: word.toLowerCase().trim() })
            .select()
            .single();

        if (error) {
            logger.error({ error }, '[vocabularyService.addWord]');
            throw error;
        }

        return data as CustomWord;
    },

    /**
     * Remove a word
     */
    async removeWord(wordId: string): Promise<void> {
        const supabase = getClient();
        const { error } = await supabase
            .from('user_filler_words')
            .delete()
            .eq('id', wordId);

        if (error) {
            logger.error({ error }, '[vocabularyService.removeWord]');
            throw error;
        }
    },
};

// ============================================================================
// Goals Service
// ============================================================================

export interface UserGoal {
    id: string;
    user_id: string;
    weekly_goal: number;  // DB column is weekly_goal, not weekly_session_goal
    clarity_goal: number;
    created_at: string;
    updated_at: string;
}

export const goalsService = {
    /**
     * Get user goals
     */
    async get(userId: string): Promise<UserGoal | null> {
        const supabase = getClient();
        const { data, error } = await supabase
            .from('user_goals')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                logger.debug({ userId }, '[goalsService.get] Goals not found');
                return null;
            }
            logger.error({ error, userId }, '[goalsService.get]');
            throw error;
        }

        return data as UserGoal;
    },

    /**
     * Upsert user goals
     */
    async upsert(userId: string, goals: Partial<UserGoal>): Promise<UserGoal> {
        const supabase = getClient();
        const { data, error } = await supabase
            .from('user_goals')
            .upsert({ user_id: userId, ...goals })
            .select()
            .single();

        if (error) {
            logger.error({ error }, '[goalsService.upsert]');
            throw error;
        }

        return data as UserGoal;
    },
};
