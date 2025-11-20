import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useAuthProvider } from '@/contexts/AuthProvider';

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
    const { data: vocabulary = [], isLoading, error } = useQuery({
        queryKey: ['customVocabulary', user?.id],
        queryFn: async () => {
            if (!supabase || !user) return [];

            const { data, error } = await supabase
                .from('custom_vocabulary')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return (data as CustomWord[]) || [];
        },
        enabled: !!user && !!supabase,
    });

    // Add a new word
    const addWord = useMutation({
        mutationFn: async (word: string) => {
            if (!supabase || !user) throw new Error('Not authenticated');

            // Validate word
            const trimmed = word.trim().toLowerCase();
            if (!trimmed) throw new Error('Word cannot be empty');
            if (trimmed.length > 50) throw new Error('Word must be 50 characters or less');
            if (!/^[a-z0-9\-']+$/i.test(trimmed)) {
                throw new Error('Word can only contain letters, numbers, hyphens, and apostrophes');
            }

            // Check if word already exists
            if (vocabulary.some(w => w.word.toLowerCase() === trimmed)) {
                throw new Error('Word already in vocabulary');
            }

            // Check word limit
            if (vocabulary.length >= 100) {
                throw new Error('Maximum 100 custom words allowed');
            }

            const { data, error } = await supabase
                .from('custom_vocabulary')
                .insert({ user_id: user.id, word: trimmed })
                .select()
                .single();

            if (error) throw error;
            return data as CustomWord;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['customVocabulary', user?.id] });
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
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['customVocabulary', user?.id] });
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
