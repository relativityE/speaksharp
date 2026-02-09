import React, { useState, FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, X } from 'lucide-react';
import { useUserFillerWords } from '@/hooks/useUserFillerWords';
import { VOCABULARY_LIMITS } from '@/config';
import logger from '@/lib/logger';

interface UserFillerWordsManagerProps {
    onWordAdded?: () => void;
}

export const UserFillerWordsManager: React.FC<UserFillerWordsManagerProps> = ({ onWordAdded }) => {
    const [newWord, setNewWord] = useState('');
    const {
        fullVocabularyObjects: vocabulary, // Renamed in hook, mapping here
        isLoading,
        addWord,
        removeWord,
        isAdding,
        isRemoving,
        error: addError // Hook returns error as 'error', mapping to addError
    } = useUserFillerWords();

    // Simplified dynamic capacity: Start at 100, expand in 100-word increments as needed
    const currentCount = vocabulary.length;
    const maxWords = Math.max(
        VOCABULARY_LIMITS.BASE_CAPACITY,
        (Math.floor(currentCount / 100) + 1) * 100
    );
    const isAtLimit = currentCount >= maxWords;

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        logger.info({ newWord }, '[UserFillerWordsManager] handleSubmit called');

        if (newWord.trim()) {
            logger.info({ word: newWord.trim() }, '[UserFillerWordsManager] Calling addWord mutation');
            try {
                addWord(newWord.trim(), {
                    onSuccess: () => {
                        logger.info('[UserFillerWordsManager] onSuccess callback - clearing input');
                        setNewWord('');
                        if (onWordAdded) {
                            onWordAdded();
                        }
                    },
                    onError: (error) => {
                        logger.error({ error }, '[UserFillerWordsManager] onError callback');
                    }
                });
            } catch (error) {
                logger.error({ error }, '[UserFillerWordsManager] Error calling addWord');
            }
        } else {
            logger.info('[UserFillerWordsManager] newWord is empty after trim, not submitting');
        }
    };

    return (
        <div className="w-full">
            <div className="mb-4">
                <h4 className="font-semibold flex items-center gap-2">
                    User Filler Words
                    <span className={`text-xs font-normal ${isAtLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
                        ({vocabulary.length}/{maxWords})
                    </span>
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                    Add words you want tracked.
                </p>
            </div>

            <div className="space-y-4">
                {/* Add Word Form */}
                <form onSubmit={handleSubmit} className="flex gap-2">
                    <Input
                        type="text"
                        value={newWord}
                        onChange={(e) => setNewWord(e.target.value)}
                        placeholder="e.g., literally, basic"
                        disabled={isAdding || isAtLimit}
                        className="flex-1 h-8 text-sm"
                        data-testid="user-filler-words-input"
                    />
                    <Button
                        type="submit"
                        size="sm"
                        disabled={!newWord.trim() || isAdding || isAtLimit}
                        aria-label="Add word"
                        className="h-8 w-8 p-0"
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
                </form>

                {/* Error Message */}
                {addError && (
                    <p className="text-xs text-destructive" role="alert">
                        {addError instanceof Error ? addError.message : 'Failed to add word'}
                    </p>
                )}

                {/* Loading State */}
                {isLoading ? (
                    <div className="space-y-2">
                        <div className="h-8 bg-secondary/50 rounded-md animate-pulse" />
                        <div className="h-8 bg-secondary/50 rounded-md animate-pulse" />
                    </div>
                ) : vocabulary.length > 0 ? (
                    <div className="space-y-1 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                        {vocabulary.map((word) => (
                            <div
                                key={word.id}
                                className="flex items-center justify-between p-1.5 rounded-md bg-secondary/30 hover:bg-secondary/50 transition-colors group"
                            >
                                <span className="text-sm font-medium pl-1" data-testid="filler-word-badge">{word.word}</span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeWord(word.id)}
                                    disabled={isRemoving}
                                    className="h-6 w-6 opacity-50 group-hover:opacity-100"
                                    aria-label={`Remove ${word.word}`}
                                >
                                    <X className="h-3 w-3" />
                                </Button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground text-center py-2">
                        No custom words yet.
                    </p>
                )}
            </div>
        </div>
    );
};
