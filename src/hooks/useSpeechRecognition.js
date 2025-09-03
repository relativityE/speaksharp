import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import TranscriptionService from '../services/transcription/TranscriptionService';
import { FILLER_WORD_KEYS } from '../config';
import logger from '../lib/logger';

const defaultFillerPatterns = {
    [FILLER_WORD_KEYS.UM]: /\b(um|umm|ummm|uhm)\b/gi,
    [FILLER_WORD_KEYS.UH]: /\b(uh|uhh|uhhh|er|err|erh)\b/gi,
    [FILLER_WORD_KEYS.AH]: /\b(ah|ahm|ahhh)\b/gi,
    [FILLER_WORD_KEYS.LIKE]: /\b(like)\b/gi,
    [FILLER_WORD_KEYS.YOU_KNOW]: /\b(you know|y'know|ya know)\b/gi,
    [FILLER_WORD_KEYS.SO]: /\b(so)\b/gi,
    [FILLER_WORD_KEYS.ACTUALLY]: /\b(actually)\b/gi,
    [FILLER_WORD_KEYS.OH]: /\b(oh|ooh|ohh)\b/gi,
    [FILLER_WORD_KEYS.I_MEAN]: /\b(i mean)\b/gi,
};

const FILLER_WORD_COLORS = ['#BFDBFE', '#FCA5A5', '#FDE68A', '#86EFAC', '#FDBA74', '#C4B5FD', '#6EE7B7'];

// FIX 1: Memoize this function outside component to prevent recreation
const createInitialFillerData = (customWords = []) => {
    const initial = {};
    const allFillerKeys = [...Object.values(FILLER_WORD_KEYS), ...customWords];
    allFillerKeys.forEach((key, index) => {
        initial[key] = { count: 0, color: FILLER_WORD_COLORS[index % FILLER_WORD_COLORS.length] };
    });
    return initial;
};

export const useSpeechRecognition = ({
    customWords = [],
    session,
    profile,
} = {}) => {
    const { session: authSession } = useAuth();
    const navigate = useNavigate();

    // FIX 2: Memoize initial filler data to prevent recreation
    const initialFillerData = useMemo(() => createInitialFillerData(customWords), [customWords]);

    const [isListening, setIsListening] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [finalChunks, setFinalChunks] = useState([]);
    const [wordConfidences, setWordConfidences] = useState([]);
    const [interimTranscript, setInterimTranscript] = useState('');
    const [fillerData, setFillerData] = useState(initialFillerData);
    const [finalFillerData, setFinalFillerData] = useState(initialFillerData);
    const [error, setError] = useState(null);
    const [isSupported, setIsSupported] = useState(true);
    const [currentMode, setCurrentMode] = useState(null);
    const [modelLoadingProgress, setModelLoadingProgress] = useState(null);

    const transcriptionServiceRef = useRef(null);
    const isMountedRef = useRef(true);

    // FIX 3: Add ref to track debounce timer for cleanup
    const debounceTimerRef = useRef(null);

    // FIX 4: Proper cleanup on unmount with timer cleanup
    useEffect(() => {
        isMountedRef.current = true;

        return () => {
            isMountedRef.current = false;

            // Clear any pending debounce timers
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }

            // Cleanup transcription service
            if (transcriptionServiceRef.current) {
                transcriptionServiceRef.current.destroy().catch(err => {
                    console.error('Error destroying transcription service:', err);
                });
                transcriptionServiceRef.current = null;
            }
        };
    }, []);

    // FIX 5: Memoize patterns to prevent recreation
    const allPatterns = useMemo(() => {
        const patterns = { ...defaultFillerPatterns };
        customWords.forEach((word) => {
            patterns[word] = new RegExp(`\\b(${word})\\b`, 'gi');
        });
        return patterns;
    }, [customWords]);

    // FIX 6: Optimize filler word counting with stable reference
    const countFillerWords = useCallback((text) => {
        const counts = createInitialFillerData(customWords);

        for (const key in allPatterns) {
            const pattern = allPatterns[key];
            const matches = text.match(pattern);
            if (matches) {
                counts[key].count = matches.length;
            }
        }
        return counts;
    }, [customWords, allPatterns]);

    // FIX 7: Stable callbacks to prevent re-render loops
    const onModelLoadProgress = useCallback((progress) => {
        if (isMountedRef.current) {
            setModelLoadingProgress(progress);
        }
    }, []);

    const handleReady = useCallback(() => {
        if (isMountedRef.current) {
            setIsReady(true);
        }
    }, []);

    // FIX 8: Add bounds checking constants
    const MAX_CHUNKS = 1000;
    const MAX_WORD_CONFIDENCES = 5000;

    const onTranscriptUpdate = useCallback((data) => {
        if (!isMountedRef.current) return;

        if (data.transcript?.partial && !data.transcript.partial.startsWith('Downloading model')) {
            setInterimTranscript(data.transcript.partial);
        }

        if (data.transcript?.final) {
            setFinalChunks(prev => {
                const newChunks = [...prev, { text: data.transcript.final, id: Date.now() + Math.random() }];
                return newChunks.length > MAX_CHUNKS ? newChunks.slice(-MAX_CHUNKS) : newChunks;
            });
            setInterimTranscript('');
        }

        if (data.words && data.words.length > 0) {
            setWordConfidences(prev => {
                const newConfidences = [...prev, ...data.words];
                return newConfidences.length > MAX_WORD_CONFIDENCES
                    ? newConfidences.slice(-MAX_WORD_CONFIDENCES)
                    : newConfidences;
            });
        }
    }, []);

    // FIX 9: Fixed debounced function with proper cleanup
    const debouncedCountFillerWords = useCallback((text, callback) => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        debounceTimerRef.current = setTimeout(() => {
            if (isMountedRef.current) {
                try {
                    const result = countFillerWords(text);
                    callback(result);
                } catch (error) {
                    console.error('Error counting filler words:', error);
                }
            }
            debounceTimerRef.current = null;
        }, 100);
    }, [countFillerWords]);

    // FIX 10: Simplified effect with stable dependencies
    useEffect(() => {
        if (!isMountedRef.current) return;

        const fullTranscript = finalChunks.map(c => c.text).join(' ') + ' ' + interimTranscript;
        const finalTranscriptOnly = finalChunks.map(c => c.text).join(' ');

        // Debounced live filler counting
        debouncedCountFillerWords(fullTranscript, (newFillerData) => {
            if (isMountedRef.current) {
                setFillerData(newFillerData);
            }
        });

        // Immediate final filler counting (no debounce needed for final)
        try {
            const newFinalFillerData = countFillerWords(finalTranscriptOnly);
            setFinalFillerData(newFinalFillerData);
        } catch (error) {
            console.error('Error counting final filler words:', error);
        }
    }, [finalChunks, interimTranscript, debouncedCountFillerWords, countFillerWords]);

    // FIX 11: Stable transcript update effect
    useEffect(() => {
        const newTranscript = finalChunks.map(c => c.text).join(' ');
        setTranscript(newTranscript);
    }, [finalChunks]);

    // FIX 12: Memoize getAssemblyAIToken to prevent recreation
    const getAssemblyAIToken = useCallback(async () => {
        try {
            logger.info('[getAssemblyAIToken] Starting...');
            let userSession = authSession;

            const isDevMode = import.meta.env.VITE_DEV_MODE === 'true';

            if (isDevMode && !userSession) {
                logger.info('[getAssemblyAIToken] Dev mode - attempting anonymous sign-in...');
                const { data, error } = await supabase.auth.signInAnonymously();
                if (error) throw new Error(`Anonymous sign-in failed: ${error.message}`);
                if (!data.session) throw new Error('Anonymous sign-in did not return a session.');
                userSession = data.session;
            }

            const { data, error } = await supabase.functions.invoke('assemblyai-token', {
                body: {},
            });

            if (error) {
                throw new Error(`Failed to invoke token function: ${error.message}`);
            }

            if (!data || !data.token) {
                throw new Error("No valid AssemblyAI token returned.");
            }
            return data.token;
        } catch (err) {
            logger.error({ err }, "❌ Error getting AssemblyAI token:");
            if (isMountedRef.current) {
                toast.error("Unable to start transcription: " + err.message, {
                    className: "toast toast-md toast-error",
                });
            }
            return null;
        }
    }, [authSession]);

    // FIX 13: Wrap async functions in useCallback
    const startListening = useCallback(async ({ forceCloud = false } = {}) => {
        if (isListening || !isMountedRef.current) {
            return;
        }

        setIsReady(false);
        setError(null);
        setIsSupported(true);

        try {
            // Cleanup existing service
            if (transcriptionServiceRef.current) {
                await transcriptionServiceRef.current.destroy();
                transcriptionServiceRef.current = null;
            }

            const service = new TranscriptionService({
                onTranscriptUpdate,
                onModelLoadProgress,
                onReady: handleReady,
                profile,
                forceCloud,
                session,
                navigate,
                getAssemblyAIToken,
            });

            await service.init();

            if (!isMountedRef.current) return; // Check if still mounted after async operation

            transcriptionServiceRef.current = service;
            setIsListening(true);

            await service.startTranscription();

            if (isMountedRef.current) {
                setCurrentMode(service.mode);
            }
        } catch (err) {
            if (isMountedRef.current) {
                setError(err);
                setIsListening(false);
                if (err.message.toLowerCase().includes('not supported') ||
                    err.message.toLowerCase().includes('permission denied')) {
                    setIsSupported(false);
                }
            }
        }
    }, [isListening, onTranscriptUpdate, onModelLoadProgress, handleReady, profile, session, navigate, getAssemblyAIToken]);

    const stopListening = useCallback(async () => {
        if (!isListening || !transcriptionServiceRef.current || !isMountedRef.current) {
            return null;
        }

        try {
            await transcriptionServiceRef.current.stopTranscription();

            if (isMountedRef.current) {
                setIsListening(false);
                setIsReady(false);

                const finalTranscriptText = [...finalChunks.map(c => c.text), interimTranscript].join(' ').trim();
                const averageConfidence = wordConfidences.length > 0
                    ? wordConfidences.reduce((sum, word) => sum + word.confidence, 0) / wordConfidences.length
                    : 0;

                return {
                    transcript: finalTranscriptText,
                    filler_words: finalFillerData,
                    total_words: finalTranscriptText.split(/\s+/).filter(Boolean).length,
                    accuracy: averageConfidence,
                };
            }
        } catch (error) {
            console.error('Error stopping transcription:', error);
            if (isMountedRef.current) {
                setError(error);
            }
        }

        return null;
    }, [isListening, finalChunks, interimTranscript, wordConfidences, finalFillerData]);

    // FIX 14: Improved reset function
    const reset = useCallback(() => {
        if (!isMountedRef.current) return;

        // Clear debounce timer
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }

        setFinalChunks([]);
        setInterimTranscript('');
        setTranscript('');
        setFillerData(initialFillerData);
        setFinalFillerData(initialFillerData);
        setWordConfidences([]);
        setError(null);
        setIsReady(false);
        setModelLoadingProgress(null);
    }, [initialFillerData]);

    return {
        isListening,
        isReady,
        transcript,
        chunks: finalChunks,
        interimTranscript,
        fillerData,
        error,
        isSupported,
        startListening,
        stopListening,
        reset,
        mode: currentMode,
        modelLoadingProgress,
    };
};
