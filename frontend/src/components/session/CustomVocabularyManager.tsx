import React, { useState, FormEvent } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, X } from 'lucide-react';
import { useCustomVocabulary } from '@/hooks/useCustomVocabulary';
import { VOCABULARY_LIMITS } from '@/config';

export const CustomVocabularyManager: React.FC = () => {
    const [newWord, setNewWord] = useState('');
    const {
        vocabulary,
        isLoading,
        addWord,
        removeWord,
        isAdding,
        isRemoving,
        addError
    } = useCustomVocabulary();

    // Simplified dynamic capacity: Start at 100, expand in 100-word increments as needed
    const currentCount = vocabulary.length;
    const maxWords = Math.max(
        VOCABULARY_LIMITS.BASE_CAPACITY,
        (Math.floor(currentCount / 100) + 1) * 100
    );
    const isAtLimit = currentCount >= maxWords;

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
                    Capacity expands automatically in 100-word increments.
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
