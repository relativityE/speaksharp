import React, { useState, FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, X } from 'lucide-react';
import { useUserFillerWords } from '@/hooks/useUserFillerWords';
import { useDiscourseMarkerPref } from '@/hooks/useDiscourseMarkerPref';
import logger from '../../lib/logger';

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
        maxWords,
        error: addError // Hook returns error as 'error', mapping to addError
    } = useUserFillerWords();
    const {
        includeDiscourseMarkers,
        setIncludeDiscourseMarkers,
        isSaving: isSavingDiscoursePref,
    } = useDiscourseMarkerPref();

    const currentCount = vocabulary.length;
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
                    User Words
                    <span className={`text-xs font-semibold ${isAtLimit ? 'text-destructive' : 'text-foreground/70'}`}>
                        ({vocabulary.length}/{maxWords})
                    </span>
                </h4>
                <p className="mt-1 text-xs font-medium text-foreground/70">
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
                        placeholder="e.g., literally, honestly"
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
                        data-testid="user-filler-words-add-button"
                        onClick={() => logger.info('[UserFillerWordsManager] Add Button Clicked')}
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
                    <p className="py-2 text-center text-xs font-medium text-foreground/70">
                        No user words yet.
                    </p>
                )}
            </div>

            {/* #1231 filler slice 2 — opt in to counting discourse markers in the session filler total.
                Default off: the headline counts true fillers (um/uh/ah) + the words above. */}
            <div className="mt-4 pt-4 border-t border-border/60">
                <label className="flex items-start gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={includeDiscourseMarkers}
                        disabled={isSavingDiscoursePref}
                        onChange={(e) => setIncludeDiscourseMarkers(e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0"
                        data-testid="discourse-marker-toggle"
                        aria-label="Count discourse markers in my filler total"
                    />
                    <span className="text-xs font-medium text-foreground/80">
                        Count discourse markers (like, so, you know) in my filler total
                    </span>
                </label>
            </div>
        </div>
    );
};
