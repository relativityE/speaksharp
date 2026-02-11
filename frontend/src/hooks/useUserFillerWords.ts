import { useMemo } from 'react';
import logger from '@/lib/logger';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '../lib/supabaseClient';
import { useAuthProvider } from '../contexts/AuthProvider';
import { useUsageLimit } from './useUsageLimit';
import { toast } from '@/lib/toast';
import { getMaxFillerWords } from '../constants/subscriptionTiers';

interface CustomWord {
    id: string;
    word: string;
    created_at: string;
    user_id: string;
}

export const useUserFillerWords = () => {
    const { session } = useAuthProvider();
    const queryClient = useQueryClient();
    const { data: usageData } = useUsageLimit(); // Use the usage limit hook
    const isPro = usageData?.is_pro ?? false;
    const supabase = getSupabaseClient();

    // Use usage limits from hook or fallback to centralized config
    const MAX_WORDS = getMaxFillerWords(usageData?.subscription_status);

    const { data: userFillerWords = [], isLoading, error } = useQuery({
        queryKey: ['user-filler-words', session?.user?.id],
        queryFn: async () => {
            if (!session?.user?.id) return [];
            const { data, error } = await supabase
                .from('user_filler_words')
                .select('*')
                .eq('user_id', session.user.id);

            if (error) {
                logger.error({ err: error }, '[useUserFillerWords] Error fetching');
                throw error;
            }
            return data as CustomWord[];
        },
        enabled: !!session?.user?.id,
        // Cache invalidation strategy
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

    const addWordMutation = useMutation({
        mutationFn: async (word: string) => {
            if (!session?.user?.id) throw new Error('No user logged in');

            // 1. Validation (Clean word)
            const cleanedWord = word.trim().toLowerCase();
            if (!cleanedWord) throw new Error('Word cannot be empty');

            // 2. Check duplicates (Case insensitive)
            const exists = userFillerWords.some(w => w.word.toLowerCase() === cleanedWord.toLowerCase());
            if (exists) throw new Error('Word already in list');

            // 3. Limit Check
            if (userFillerWords.length >= MAX_WORDS) {
                throw new Error(isPro
                    ? `Pro limit reached (${MAX_WORDS} words).`
                    : `Free limit reached (${MAX_WORDS} words). Upgrade to Pro to add more.`
                );
            }

            if (!session?.user?.id) throw new Error('No user session');

            // Expert Fix: Use .select() to return the inserted data immediately
            // This bypasses Vercel/CDN cache on the subsequent GET request
            const { data, error } = await supabase
                .from('user_filler_words')
                .insert([{ word: cleanedWord, user_id: session.user.id }])
                .select()
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: (newItem) => {
            // Expert Fix: Manually update cache with authoritative data from DB
            queryClient.setQueryData(['user-filler-words', session?.user?.id], (old: CustomWord[] = []) => {
                return [...old, newItem];
            });
            toast.success('Word added to detection list');
        },
        onError: (err: Error) => {
            logger.error({ err }, '[useUserFillerWords] Add error');
            toast.error(err.message);
        }
    });

    const removeWordMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase
                .from('user_filler_words')
                .delete()
                .eq('id', id);

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['user-filler-words', session?.user?.id] });
            toast.success('Word removed');
        },
        onError: (err) => {
            toast.error('Failed to remove word');
            logger.error({ err }, '[useUserFillerWords] Remove error');
        }
    });

    // Memoize the mapped array to ensure referential stability
    // This prevents infinite render loops in consumers like SessionPage
    const simpleWords = useMemo(() => userFillerWords.map(v => v.word), [userFillerWords]);

    return {
        userFillerWords: simpleWords, // Return stable reference
        fullVocabularyObjects: userFillerWords, // Return full objects for UI (Need IDs for delete)
        isLoading,
        error,
        addWord: addWordMutation.mutate,
        removeWord: removeWordMutation.mutate,
        isAdding: addWordMutation.isPending,
        isRemoving: removeWordMutation.isPending,
        count: userFillerWords.length,
        maxWords: MAX_WORDS,
        isPro
    };
};
