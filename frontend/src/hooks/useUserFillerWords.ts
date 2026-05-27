import { useMemo } from 'react';
import logger from '../lib/logger';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '../lib/supabaseClient';
import { useAuthProvider } from '../contexts/AuthProvider';
import { useUsageLimit, type UsageLimitCheck } from './useUsageLimit';
import { useSessionStore } from '@/stores/useSessionStore';
import { toast } from '@/lib/toast';
import { getMaxFillerWords } from '../constants/subscriptionTiers';

interface UserWord {
    id: string;
    word: string;
    created_at: string;
    user_id: string;
}

const MAX_USER_FILLER_WORD_LENGTH = 50;
const SAFE_CUSTOM_WORD_PATTERN = /^[\p{L}\p{N}'’\- ]+$/u;

const hasControlCharacter = (value: string): boolean => {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 31 || code === 127) {
            return true;
        }
    }

    return false;
};

export const normalizeUserFillerWord = (word: unknown): string => {
    if (typeof word !== 'string') throw new Error('Word must be text');
    return word.trim().replace(/\s+/g, ' ').toLowerCase();
};

const isUserWord = (value: unknown): value is UserWord => {
    const candidate = value as Partial<UserWord> | null;
    return Boolean(
        candidate &&
        typeof candidate.id === 'string' &&
        typeof candidate.word === 'string' &&
        candidate.word.trim().length > 0
    );
};

export const sanitizeUserFillerWords = (words: unknown): UserWord[] =>
    Array.isArray(words) ? words.filter(isUserWord) : [];

export const validateUserFillerWord = (
    word: unknown,
    existingWords: Array<Pick<UserWord, 'word'>>,
    maxWords: number,
    isPro: boolean
): string => {
    const cleanedWord = normalizeUserFillerWord(word);
    if (!cleanedWord) throw new Error('Word cannot be empty');
    if (cleanedWord.length > MAX_USER_FILLER_WORD_LENGTH) {
        throw new Error(`Word must be ${MAX_USER_FILLER_WORD_LENGTH} characters or fewer`);
    }
    if (!SAFE_CUSTOM_WORD_PATTERN.test(cleanedWord) || hasControlCharacter(cleanedWord)) {
        throw new Error('Use letters, numbers, spaces, hyphens, or apostrophes only.');
    }

    const exists = existingWords.some(w => normalizeUserFillerWord(w.word) === cleanedWord);
    if (exists) throw new Error('Word already in list');

    if (existingWords.length >= maxWords) {
        throw new Error(isPro
            ? `Pro limit reached (${maxWords} words).`
            : `Free limit reached (${maxWords} words). Upgrade to Pro to add more.`
        );
    }

    return cleanedWord;
};

export const useUserFillerWords = () => {
    const { session } = useAuthProvider();
    const queryClient = useQueryClient();
    const e2eDeps = (typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>).__E2E_DEPS__ : null) as { fetchUsageLimit?: () => Promise<UsageLimitCheck> } | null;
    const { data: usageLimitData } = useUsageLimit(e2eDeps || undefined);
    const isPro = usageLimitData?.is_pro ?? false;
    const supabase = getSupabaseClient();
    const setSTTStatus = useSessionStore(s => s.setSTTStatus);

    // Use usage limits from hook or fallback to centralized config
    const MAX_WORDS = getMaxFillerWords(usageLimitData?.subscription_status);

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
            return sanitizeUserFillerWords(data);
        },
        enabled: !!session?.user?.id,
        // Cache invalidation strategy
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

    const wordById = useMemo(() => {
        const index = new Map<string, string>();
        for (const word of sanitizeUserFillerWords(userFillerWords)) {
            index.set(word.id, word.word);
        }
        return index;
    }, [userFillerWords]);

    const addWordMutation = useMutation({
        mutationFn: async (word: string) => {
            if (!session?.user?.id) throw new Error('No user logged in');

            const cleanedWord = validateUserFillerWord(word, userFillerWords, MAX_WORDS, isPro);

            if (!session?.user?.id) throw new Error('No user session');

            // Use .select() to return the inserted data immediately
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
            const sanitizedItem = sanitizeUserFillerWords(Array.isArray(newItem) ? newItem : [newItem])[0] ?? null;
            // Manually update cache with authoritative data from DB
            queryClient.setQueryData(['user-filler-words', session?.user?.id], (old: UserWord[] = []) => {
                const existingWords = sanitizeUserFillerWords(old);
                return sanitizedItem ? [...existingWords, sanitizedItem] : existingWords;
            });
            void queryClient.invalidateQueries({ queryKey: ['user-filler-words', session?.user?.id] });
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
        onSuccess: (_, id) => {
            const removedWord = wordById.get(id);
            void queryClient.invalidateQueries({ queryKey: ['user-filler-words', session?.user?.id] });
            toast.success('Word removed');

            if (removedWord) {
                setSTTStatus({
                    type: 'info',
                    message: `User word "${removedWord}" no longer tracked`
                });

                // Revert to ready after 3 seconds
                setTimeout(() => {
                    setSTTStatus({ type: 'ready', message: 'Ready to record' });
                }, 3000);
            }
        },
        onError: (err) => {
            toast.error('Failed to remove word');
            logger.error({ err }, '[useUserFillerWords] Remove error');
        }
    });

    // Memoize the mapped array to ensure referential stability
    // This prevents infinite render loops in consumers like SessionPage
    const fullVocabularyObjects = useMemo(() => sanitizeUserFillerWords(userFillerWords), [userFillerWords]);
    const simpleWords = useMemo(() => fullVocabularyObjects.map(v => v.word), [fullVocabularyObjects]);

    return {
        userFillerWords: simpleWords, // Return stable reference
        fullVocabularyObjects, // Return full objects for UI (Need IDs for delete)
        isLoading,
        error,
        addWord: addWordMutation.mutate,
        removeWord: removeWordMutation.mutate,
        isAdding: addWordMutation.isPending,
        isRemoving: removeWordMutation.isPending,
        count: fullVocabularyObjects.length,
        maxWords: MAX_WORDS,
        isPro
    };
};
