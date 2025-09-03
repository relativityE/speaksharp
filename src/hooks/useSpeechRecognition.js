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

// FIX 1: Memoize this function to prevent recreation on every render
const getInitialFillerData = (customWords = []) => {
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
    const [isListening, setIsListening] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [finalChunks, setFinalChunks] = useState([]);
    const [wordConfidences, setWordConfidences] = useState([]);
    const [interimTranscript, setInterimTranscript] = useState('');
    const [fillerData, setFillerData] = useState(() => getInitialFillerData(customWords));
    const [finalFillerData, setFinalFillerData] = useState(() => getInitialFillerData(customWords));
    const [error, setError] = useState(null);
    const [isSupported, setIsSupported] = useState(true);
    const [currentMode, setCurrentMode] = useState(null);
    const [modelLoadingProgress, setModelLoadingProgress] = useState(null);
    const transcriptionServiceRef = useRef(null);

    // FIX 2: Add cleanup flag to prevent state updates after unmount
    const isMountedRef = useRef(true);

    // FIX 3: Enhanced cleanup on unmount
    useEffect(() => {
        isMountedRef.current = true;

        return () => {
            isMountedRef.current = false;
            if (transcriptionServiceRef.current) {
                transcriptionServiceRef.current.destroy();
                transcriptionServiceRef.current = null;
            }
        };
    }, []);

    // FIX 4: Memoize patterns to prevent recreation
    const allPatterns = useMemo(() => {
        const patterns = { ...defaultFillerPatterns };
        customWords.forEach((word) => {
            patterns[word] = new RegExp(`\\b(${word})\\b`, 'gi');
        });
        return patterns;
    }, [customWords]);

    // FIX 5: Optimize filler word counting with memoization
    const countFillerWords = useCallback((text) => {
        const counts = getInitialFillerData(customWords);

        for (const key in allPatterns) {
            const pattern = allPatterns[key];
            const matches = text.match(pattern);
            if (matches) {
                counts[key].count = matches.length;
            }
        }
        return counts;
    }, [customWords, allPatterns]);

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

    // FIX 6: Add bounds checking to prevent infinite array growth
    const MAX_CHUNKS = 1000; // Limit chunk accumulation
    const MAX_WORD_CONFIDENCES = 5000; // Limit word confidence accumulation

    const onTranscriptUpdate = useCallback((data) => {
        if (!isMountedRef.current) return;

        if (data.transcript?.partial && !data.transcript.partial.startsWith('Downloading model')) {
            setInterimTranscript(data.transcript.partial);
        }

        if (data.transcript?.final) {
            setFinalChunks(prev => {
                const newChunks = [...prev, { text: data.transcript.final, id: Math.random() }];
                // FIX 7: Prevent unlimited accumulation
                if (newChunks.length > MAX_CHUNKS) {
                    return newChunks.slice(-MAX_CHUNKS); // Keep only the last N chunks
                }
                return newChunks;
            });
            setInterimTranscript('');
        }

        if (data.words && data.words.length > 0) {
            setWordConfidences(prev => {
                const newConfidences = [...prev, ...data.words];
                // FIX 8: Prevent unlimited accumulation
                if (newConfidences.length > MAX_WORD_CONFIDENCES) {
                    return newConfidences.slice(-MAX_WORD_CONFIDENCES); // Keep only the last N words
                }
                return newConfidences;
            });
        }
    }, []);

    // FIX 9: Debounce filler word counting to prevent excessive recalculation
    // FIX 9: Debounce filler word counting to prevent excessive recalculation
    const debouncedCountFillerWords = useMemo(() => {
        let timeoutId;
        return (text, callback) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                if (isMountedRef.current) {
                    const result = countFillerWords(text);
                    callback(result);
                }
            }, 100); // 100ms debounce
        };
    }, [countFillerWords]);

    useEffect(() => {
        const fullTranscript = finalChunks.map(c => c.text).join(' ') + ' ' + interimTranscript;

        // FIX 10: Use debounced counting for live data
        debouncedCountFillerWords(fullTranscript, (newFillerData) => {
            setFillerData(newFillerData);
        });

        const finalTranscript = finalChunks.map(c => c.text).join(' ');
        const newFinalFillerData = countFillerWords(finalTranscript);
        setFinalFillerData(newFinalFillerData);
    }, [finalChunks, interimTranscript, debouncedCountFillerWords, countFillerWords]);

    useEffect(() => {
        const newTranscript = finalChunks.map(c => c.text).join(' ');
        setTranscript(newTranscript);
    }, [finalChunks]);

    const getAssemblyAIToken = useCallback(async () => {
        try {
            logger.info('[getAssemblyAIToken] Starting...');
            logger.info({ authSession }, '[getAssemblyAIToken] Initial authSession:');
            let userSession = authSession;

            const isDevMode = import.meta.env.VITE_DEV_MODE === 'true';
            logger.info({ isDevMode }, '[getAssemblyAIToken] VITE_DEV_MODE:');

            if (isDevMode && !userSession) {
                logger.info('[getAssemblyAIToken] Dev mode is on and no session, attempting anonymous sign-in...');
                const { data, error } = await supabase.auth.signInAnonymously();
                logger.info({ data, error }, '[getAssemblyAIToken] Anonymous sign-in result:');
                if (error) throw new Error(`Anonymous sign-in failed: ${error.message}`);
                if (!data.session) throw new Error('Anonymous sign-in did not return a session.');
                userSession = data.session;
            }

            logger.info(`[getAssemblyAIToken] Final userSession has access token: ${userSession?.access_token ? 'Yes' : 'No'}`);

            const { data, error } = await supabase.functions.invoke('assemblyai-token', {
                body: {},
            });

            if (error) {
                logger.error({ error }, "Error invoking assemblyai-token function:");
                throw new Error(`Failed to invoke token function: ${error.message}`);
            }

            if (!data || !data.token) {
                logger.error({ data }, "Unexpected token response:");
                throw new Error("No valid AssemblyAI token returned.");
            }

            logger.info({ token: data.token }, "✅ AssemblyAI token acquired:");
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

    const startListening = async ({ forceCloud = false } = {}) => {
        if (isListening || !isMountedRef.current) {
            return;
        }

        setIsReady(false);
        setError(null);
        setIsSupported(true);

        // Always create a new service to ensure the latest `forceCloud` is used.
        if (transcriptionServiceRef.current) {
            await transcriptionServiceRef.current.destroy();
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
        transcriptionServiceRef.current = service;

        try {
            if (isMountedRef.current) {
                setIsListening(true);
                await transcriptionServiceRef.current.startTranscription();
                if (isMountedRef.current) {
                    setCurrentMode(transcriptionServiceRef.current.mode);
                }
            }
        } catch (err) {
            if (isMountedRef.current) {
                setError(err);
                setIsListening(false);
                if (err.message.toLowerCase().includes('not supported') || err.message.toLowerCase().includes('permission denied')) {
                    setIsSupported(false);
                }
            }
        }
    };

    const stopListening = async () => {
        if (!isListening || !transcriptionServiceRef.current || !isMountedRef.current) {
            return null;
        }

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

        return null;
    };

    // FIX 11: Improved reset function with proper cleanup
    const reset = useCallback(() => {
        if (!isMountedRef.current) return;

        setFinalChunks([]);
        setInterimTranscript('');
        setTranscript('');
        setFillerData(getInitialFillerData(customWords));
        setFinalFillerData(getInitialFillerData(customWords));
        setWordConfidences([]);
        setError(null);
        setIsReady(false);
        setModelLoadingProgress(null);
    }, [customWords]);

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
