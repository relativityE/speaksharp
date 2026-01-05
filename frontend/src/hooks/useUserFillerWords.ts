// hooks/useUserFillerWords.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '../lib/supabaseClient';
import { useAuthProvider } from '../contexts/AuthProvider';
import { useUsageLimit } from './useUsageLimit'; // Import the hook
import { toast } from 'sonner';

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

    // Use usage limits from hook or fallback to defaults (10 for Free, 100 for Pro)
    const MAX_WORDS = isPro ? 100 : 10;

    const { data: vocabularyWords = [], isLoading, error } = useQuery({
        queryKey: ['user-filler-words', session?.user?.id], // Renamed key to match feature
        queryFn: async () => {
            if (!session?.user?.id) return [];
            console.log('[useUserFillerWords] Fetching words for user:', session.user.id);
            const { data, error } = await supabase
                .from('user_filler_words') // Table name renamed to 'user_filler_words'
                .select('*')
                .eq('user_id', session.user.id);

            if (error) {
                console.error('[useUserFillerWords] Error fetching:', error);
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
            const cleanedWord = word.trim();
            if (!cleanedWord) throw new Error('Word cannot be empty');

            // 2. Check duplicates (Case insensitive)
            const exists = vocabularyWords.some(w => w.word.toLowerCase() === cleanedWord.toLowerCase());
            if (exists) throw new Error('Word already in list');

            // 3. Limit Check
            if (vocabularyWords.length >= MAX_WORDS) {
                throw new Error(isPro
                    ? `Pro limit reached (${MAX_WORDS} words).`
                    : `Free limit reached (${MAX_WORDS} words). Upgrade to Pro to add more.`
                );
            }

            // 4. Insert
            const { data, error } = await supabase
                .from('user_filler_words')
                .insert([{ user_id: session.user.id, word: cleanedWord }])
                .select()
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            // Invalidate query to refetch
            queryClient.invalidateQueries({ queryKey: ['user-filler-words', session?.user?.id] });
            toast.success('Word added to detection list');
        },
        onError: (err: Error) => {
            console.error('[useUserFillerWords] Add error:', err);
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
            console.error(err);
        }
    });

    return {
        vocabularyWords: vocabularyWords.map(v => v.word), // Return just strings for consumption
        fullVocabularyObjects: vocabularyWords, // Return full objects for UI (Need IDs for delete)
        isLoading,
        error,
        addWord: addWordMutation.mutate,
        removeWord: removeWordMutation.mutate,
        isAdding: addWordMutation.isPending,
        isRemoving: removeWordMutation.isPending,
        count: vocabularyWords.length,
        maxWords: MAX_WORDS,
        isPro
    };
};
