import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { VOCABULARY_LIMITS } from '@/config';

interface CustomWord {
    id: string;
    user_id: string;
    word: string;
    created_at: string;
}

export const useCustomVocabulary = () => {
    const { user } = useAuthProvider();
    const queryClient = useQueryClient();
    const supabase = getSupabaseClient();

    // Fetch user's custom vocabulary
    // Fetch custom vocabulary
    const { data: vocabulary = [], isLoading, error } = useQuery({
        queryKey: ['customVocabulary', user?.id],
        queryFn: async () => {
            if (!supabase || !user) return [];

            console.log('[useCustomVocabulary] GET queryKey:', ['customVocabulary', user.id]);
            console.log('[useCustomVocabulary] Fetching vocabulary for user:', user.id);
            const { data, error } = await supabase
                .from('custom_vocabulary')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            console.log('[useCustomVocabulary] Got', data?.length || 0, 'words');
            return (data as CustomWord[]) || [];
        },
        enabled: !!user && !!supabase,
        staleTime: 0, // Always consider data stale (force refetch)
        refetchOnMount: 'always', // Always refetch when component mounts
    });

    // Add a new word
    const addWord = useMutation({
        mutationFn: async (word: string) => {
            console.log('[useCustomVocabulary] ADD MUTATION STARTED for word:', word);
            console.log('[useCustomVocabulary] Current vocabulary length:', vocabulary.length);
            console.log('[useCustomVocabulary] User:', user?.id);

            if (!supabase || !user) throw new Error('Not authenticated');

            // Validate word
            const trimmed = word.trim().toLowerCase();
            console.log('[useCustomVocabulary] Trimmed word:', trimmed);
            if (!trimmed) throw new Error('Word cannot be empty');
            if (trimmed.length > VOCABULARY_LIMITS.MAX_WORD_LENGTH) {
                throw new Error(`Word must be ${VOCABULARY_LIMITS.MAX_WORD_LENGTH} characters or less`);
            }
            if (!/^[a-z0-9\-']+$/i.test(trimmed)) {
                throw new Error('Word can only contain letters, numbers, hyphens, and apostrophes');
            }

            // Check if word already exists
            if (vocabulary.some(w => w.word.toLowerCase() === trimmed)) {
                throw new Error('Word already in vocabulary');
            }

            // Check word limit (dynamic baseline)
            const currentCount = vocabulary.length;
            const maxWords = Math.max(
                VOCABULARY_LIMITS.BASE_CAPACITY,
                (Math.floor(currentCount / 100) + 1) * 100
            );

            console.log('[useCustomVocabulary] Dynamic limit reached:', maxWords, 'Current:', currentCount);
            if (currentCount >= maxWords) {
                // This shouldn't happen with the automated expansion UI, but we keep it for server-side parity
                throw new Error(`Vocabulary capacity reached (${maxWords} words).`);
            }

            console.log('[useCustomVocabulary] Validation passed, making POST request...');
            const { data, error } = await supabase
                .from('custom_vocabulary')
                .insert({ user_id: user.id, word: trimmed })
                .select()
                .single();

            if (error) throw error;
            console.log('[useCustomVocabulary] POST successful, data:', data);
            return data as CustomWord;
        },
        onSuccess: async (data) => {
            console.log('[useCustomVocabulary] Word added successfully:', data);
            console.log('[useCustomVocabulary] user.id:', user?.id);
            console.log('[useCustomVocabulary] Refetching query key:', ['customVocabulary', user?.id]);

            try {
                // Force immediate refetch instead of invalidate (better for E2E tests)
                await queryClient.refetchQueries({
                    queryKey: ['customVocabulary', user?.id],
                    exact: true
                });
                console.log('[useCustomVocabulary] Refetch complete');
            } catch (error) {
                console.error('[useCustomVocabulary] ERROR during refetch:', error);
                throw error;
            }
        },
        onError: (error) => {
            console.error('[useCustomVocabulary] ADD MUTATION ERROR:', error);
            console.error('[useCustomVocabulary] Error message:', error.message);
            console.error('[useCustomVocabulary] Error stack:', error.stack);
        },
    });

    // Remove a word
    const removeWord = useMutation({
        mutationFn: async (wordId: string) => {
            if (!supabase || !user) throw new Error('Not authenticated');

            const { error } = await supabase
                .from('custom_vocabulary')
                .delete()
                .eq('id', wordId)
                .eq('user_id', user.id);

            if (error) throw error;
        },
        onSuccess: async () => {
            console.log('[useCustomVocabulary] Word removed successfully');
            try {
                await queryClient.refetchQueries({
                    queryKey: ['customVocabulary', user?.id],
                    exact: true
                });
                console.log('[useCustomVocabulary] Refetch after remove complete');
            } catch (error) {
                console.error('[useCustomVocabulary] ERROR during remove refetch:', error);
                throw error;
            }
        },
        onError: (error) => {
            console.error('[useCustomVocabulary] REMOVE MUTATION ERROR:', error);
            console.error('[useCustomVocabulary] Error message:', error.message);
        },
    });

    return {
        vocabulary,
        vocabularyWords: vocabulary.map(v => v.word),
        isLoading,
        error,
        addWord: addWord.mutate,
        removeWord: removeWord.mutate,
        isAdding: addWord.isPending,
        isRemoving: removeWord.isPending,
        addError: addWord.error,
        removeError: removeWord.error,
    };
};
