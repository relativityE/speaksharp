import React, { useState, FormEvent } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, X, Crown } from 'lucide-react';
import { useCustomVocabulary } from '@/hooks/useCustomVocabulary';
import { useUserProfile } from '@/hooks/useUserProfile';
import { VOCABULARY_LIMITS } from '@/config';
import { isPro as checkIsPro } from '@/constants/subscriptionTiers';

export const CustomVocabularyManager: React.FC = () => {
    const [newWord, setNewWord] = useState('');
    const { data: profile } = useUserProfile();
    const {
        vocabulary,
        isLoading,
        addWord,
        removeWord,
        isAdding,
        isRemoving,
        addError
    } = useCustomVocabulary();

    const isProUser = checkIsPro(profile?.subscription_status);
    const maxWords = isProUser
        ? VOCABULARY_LIMITS.MAX_WORDS_PER_USER
        : Math.min(VOCABULARY_LIMITS.MAX_WORDS_PER_USER, VOCABULARY_LIMITS.MAX_WORDS_FREE);
    const isAtLimit = vocabulary.length >= maxWords;
    const isNearLimit = !isProUser && vocabulary.length >= maxWords - 2; // Show nudge at 8/10 words

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        console.log('[CustomVocabularyManager] handleSubmit called, newWord:', newWord);

        if (newWord.trim()) {
            console.log('[CustomVocabularyManager] Calling addWord mutation with:', newWord.trim());
            try {
                addWord(newWord.trim(), {
                    onSuccess: () => {
                        console.log('[CustomVocabularyManager] onSuccess callback - clearing input');
                        setNewWord('');
                    },
                    onError: (error) => {
                        console.error('[CustomVocabularyManager] onError callback:', error);
                    }
                });
            } catch (error) {
                console.error('[CustomVocabularyManager] Error calling addWord:', error);
            }
        } else {
            console.log('[CustomVocabularyManager] newWord is empty after trim, not submitting');
        }
    };

    if (!isProUser) {
        return (
            <Card className="border-primary/50">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Crown className="h-5 w-5 text-primary" />
                        Custom Vocabulary (Pro)
                    </CardTitle>
                    <CardDescription>
                        Upgrade to Pro to add custom words and improve transcription accuracy for technical terms, jargon, and names.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    Custom Vocabulary
                    <span className={`text-sm font-normal ${isAtLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
                        ({vocabulary.length}/{maxWords})
                    </span>
                </CardTitle>
                <CardDescription>
                    Add technical terms, jargon, or names to improve transcription accuracy.
                    {isNearLimit && !isAtLimit && (
                        <span className="block mt-1 text-xs text-primary">
                            💡 Pro users get 100 custom words
                        </span>
                    )}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Add Word Form */}
                <form onSubmit={handleSubmit} className="flex gap-2">
                    <Input
                        type="text"
                        value={newWord}
                        onChange={(e) => setNewWord(e.target.value)}
                        placeholder="e.g., SpeakSharp, AI-powered"
                        disabled={isAdding || isAtLimit}
                        className="flex-1"
                    />
                    <Button
                        type="submit"
                        size="icon"
                        disabled={!newWord.trim() || isAdding || isAtLimit}
                        aria-label="Add word"
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
                </form>

                {/* Error Message */}
                {addError && (
                    <p className="text-sm text-destructive" role="alert">
                        {addError instanceof Error ? addError.message : 'Failed to add word'}
                    </p>
                )}

                {/* Loading State */}
                {isLoading ? (
                    <div className="space-y-2">
                        <div className="h-10 bg-secondary/50 rounded-md animate-pulse" />
                        <div className="h-10 bg-secondary/50 rounded-md animate-pulse" />
                        <div className="h-10 bg-secondary/50 rounded-md animate-pulse" />
                    </div>
                ) : vocabulary.length > 0 ? (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                        {vocabulary.map((word) => (
                            <div
                                key={word.id}
                                className="flex items-center justify-between p-2 rounded-md bg-secondary/50 hover:bg-secondary transition-colors"
                            >
                                <span className="text-sm font-medium">{word.word}</span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeWord(word.id)}
                                    disabled={isRemoving}
                                    className="h-6 w-6"
                                    aria-label={`Remove ${word.word}`}
                                >
                                    <X className="h-3 w-3" />
                                </Button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                        No custom words yet. Add your first word above!
                    </p>
                )}
            </CardContent>
        </Card>
    );
};
