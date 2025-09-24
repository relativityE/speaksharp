import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../contexts/useAuth';
import { supabase } from '@/lib/supabaseClient';
import TranscriptionService, { TranscriptionServiceOptions } from '../services/transcription/TranscriptionService';
import logger from '../lib/logger';
import {
    createInitialFillerData,
    countFillerWords,
    calculateTranscriptStats,
    limitArray
} from '../utils/fillerWordUtils';
import type { UserProfile } from '../types/user';
import type { FillerCounts } from '../utils/fillerWordUtils';
import type { Session as SupabaseSession } from '@supabase/supabase-js';

const MAX_CHUNKS = 1000;
const MAX_WORD_CONFIDENCES = 5000;

interface UseSpeechRecognitionProps {
  customWords?: string[];
  session?: SupabaseSession | null;
  profile?: UserProfile | null;
}

interface Chunk {
  text: string;
  id: number;
}

interface WordConfidence {
  word: string;
  confidence: number;
}

interface TranscriptStats {
    transcript: string;
    total_words: number;
    accuracy: number;
    duration: number;
}

interface ITranscriptionService {
  init: () => Promise<{ success: boolean }>;
  startTranscription: () => Promise<void>;
  stopTranscription: () => Promise<string>;
  destroy: () => Promise<void>;
  getMode: () => 'native' | 'cloud' | 'on-device' | null;
}

export const useSpeechRecognition = ({
    customWords = [],
    session,
    profile,
}: UseSpeechRecognitionProps = {}) => {
    const { session: authSession } = useAuth();
    const navigate = useNavigate();

    const initialFillerData = useMemo(() => createInitialFillerData(customWords), [customWords]);

    const [isListening, setIsListening] = useState<boolean>(false);
    const [isReady, setIsReady] = useState<boolean>(false);
    const [transcript, setTranscript] = useState<string>('');
    const [finalChunks, setFinalChunks] = useState<Chunk[]>([]);
    const [wordConfidences, setWordConfidences] = useState<WordConfidence[]>([]);
    const [interimTranscript, setInterimTranscript] = useState<string>('');
    const [fillerData, setFillerData] = useState<FillerCounts>(initialFillerData);
    const [finalFillerData, setFinalFillerData] = useState<FillerCounts>(initialFillerData);
    const [error, setError] = useState<Error | null>(null);
    const [isSupported, setIsSupported] = useState<boolean>(true);
    const [currentMode, setCurrentMode] = useState<string | null>(null);
    const [modelLoadingProgress, setModelLoadingProgress] = useState<number | null>(null);

    const transcriptionServiceRef = useRef<ITranscriptionService | null>(null);
    const isMountedRef = useRef<boolean>(true);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const stateRef = useRef({ finalChunks, wordConfidences, interimTranscript, finalFillerData });

    const initializationStateRef = useRef({
        isInitializing: false,
        isStarting: false,
        isDestroying: false,
    });

    useEffect(() => {
        isMountedRef.current = true;
        if (typeof window !== 'undefined' && window.__E2E_MODE__) {
            window.transcriptionServiceRef = transcriptionServiceRef;
        }
        return () => {
            isMountedRef.current = false;
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
            if (transcriptionServiceRef.current) {
                transcriptionServiceRef.current.destroy().catch(err => {
                    logger.error({ err }, 'Error destroying transcription service on unmount');
                });
            }
        };
    }, []);

    useEffect(() => {
        stateRef.current = {
            finalChunks,
            wordConfidences,
            interimTranscript,
            finalFillerData,
        };
    }, [finalChunks, wordConfidences, interimTranscript, finalFillerData]);

    const onModelLoadProgress = useCallback((progress: number) => {
        if (isMountedRef.current) setModelLoadingProgress(progress);
    }, []);

    const handleReady = useCallback(() => {
        if (typeof window !== 'undefined' && window.__E2E_MODE__) {
            window.__TRANSCRIPTION_READY__ = true;
        }
        if (isMountedRef.current) setIsReady(true);
    }, []);

    const onTranscriptUpdate = useCallback((data: { transcript?: { partial?: string; final?: string }; words?: WordConfidence[] }) => {
        if (!isMountedRef.current) return;
        if (data.transcript?.partial && !data.transcript.partial.startsWith('Downloading model')) {
            setInterimTranscript(data.transcript.partial);
        }
        if (data.transcript && typeof data.transcript.final === 'string') {
            const finalText = data.transcript.final;
            setFinalChunks(prev => limitArray([...prev, { text: finalText, id: Date.now() + Math.random() }], MAX_CHUNKS));
            setInterimTranscript('');
        }
        if (data.words) {
            setWordConfidences(prev => limitArray([...prev, ...(data.words || [])], MAX_WORD_CONFIDENCES));
        }
    }, []);

    // FIXED: Remove customWords from dependencies to prevent infinite loop
    const debouncedCountFillerWords = useCallback((text: string, customWordsArray: string[], callback: (result: FillerCounts) => void) => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
            if (isMountedRef.current) {
                try {
                    const result = countFillerWords(text, customWordsArray);
                    callback(result);
                } catch (err) {
                    logger.error({ err }, 'Error counting filler words');
                }
            }
        }, 50);
    }, []); // No dependencies - this prevents infinite loop

    // FIXED: Remove debouncedCountFillerWords from dependencies to prevent infinite loop
    useEffect(() => {
        const fullTranscript = finalChunks.map(c => c.text).join(' ') + ' ' + interimTranscript;
        const finalTranscriptOnly = finalChunks.map(c => c.text).join(' ');
        
        // Pass customWords as parameter instead of relying on closure
        debouncedCountFillerWords(fullTranscript, customWords, setFillerData);
        setFinalFillerData(countFillerWords(finalTranscriptOnly, customWords));
        setTranscript(finalTranscriptOnly);
    }, [finalChunks, interimTranscript, customWords]); // Removed debouncedCountFillerWords

    const getAssemblyAIToken = useCallback(async (): Promise<string | null> => {
        try {
            let userSession = authSession;
            if (import.meta.env.VITE_DEV_MODE === 'true' && !userSession) {
                const { data, error } = await supabase.auth.signInAnonymously();
                if (error) throw new Error(`Anonymous sign-in failed: ${error.message}`);
                if (!data.session) throw new Error('Anonymous sign-in did not return a session.');
                userSession = data.session;
            }
            const { data, error } = await supabase.functions.invoke('assemblyai-token', { body: {} });
            if (error) throw new Error(`Failed to invoke token function: ${error.message}`);
            if (!data || !data.token) throw new Error("No valid AssemblyAI token returned.");
            return data.token;
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            logger.error({ err }, "Error getting AssemblyAI token");
            if (isMountedRef.current) toast.error("Unable to start transcription: " + errorMessage);
            return null;
        }
    }, [authSession]);

    const startListening = useCallback(async ({ forceCloud = false, forceOnDevice = false, forceNative = false }: { forceCloud?: boolean; forceOnDevice?: boolean; forceNative?: boolean } = {}) => {
        if (isListening || !isMountedRef.current || initializationStateRef.current.isInitializing) return;

        initializationStateRef.current.isInitializing = true;
        setIsListening(true);
        setError(null);
        setIsReady(false);
        setIsSupported(true);

        try {
            if (transcriptionServiceRef.current) {
                await transcriptionServiceRef.current.destroy();
                transcriptionServiceRef.current = null;
            }

            const serviceOptions: TranscriptionServiceOptions = {
                onTranscriptUpdate, onModelLoadProgress, onReady: handleReady,
                profile: profile ?? null,
                forceCloud, forceOnDevice, forceNative,
                session: session ?? null,
                navigate, getAssemblyAIToken,
            };
            const service = new TranscriptionService(serviceOptions);

            transcriptionServiceRef.current = service as unknown as ITranscriptionService;
            await service.init();
            if (!isMountedRef.current) return;

            await service.startTranscription();
            if (isMountedRef.current) setCurrentMode(service.getMode());
        } catch (err) {
            if (isMountedRef.current) {
                let friendlyError: Error;
                const originalError = err instanceof Error ? err : new Error(String(err));
                const message = originalError.message.toLowerCase();

                if (message.includes('permission denied')) {
                    friendlyError = new Error('Microphone permission denied. Please enable microphone access in your browser settings.');
                    setIsSupported(false);
                } else if (message.includes('assemblyai token')) {
                    friendlyError = new Error('Could not connect to the cloud transcription service. Please check your internet connection and try again.');
                } else if (message.includes('failed to load model')) {
                    friendlyError = new Error('Failed to load the on-device model. Please check your internet connection or try a different transcription mode.');
                } else if (message.includes('not initialized')) {
                    friendlyError = new Error('The transcription service could not be started. Please try refreshing the page.');
                }
                else {
                    friendlyError = new Error('An unexpected error occurred. Please try again.');
                }

                logger.error({ err: originalError }, 'An error occurred during speech recognition setup');
                setError(friendlyError);
                setIsListening(false);
            }
        } finally {
            initializationStateRef.current.isInitializing = false;
        }
    }, [isListening, profile, session, navigate, getAssemblyAIToken, onTranscriptUpdate, onModelLoadProgress, handleReady]);

    const stopListening = useCallback(async (): Promise<(TranscriptStats & { filler_words: FillerCounts }) | null> => {
        if (!isListening || !isMountedRef.current) return null;
        while (initializationStateRef.current.isInitializing) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        if (!transcriptionServiceRef.current) return null;

        try {
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

            await transcriptionServiceRef.current.stopTranscription();
            if (isMountedRef.current) {
                setIsListening(false);
                setIsReady(false);
                const { finalChunks, wordConfidences, interimTranscript, finalFillerData } = stateRef.current;
                const stats = calculateTranscriptStats(finalChunks, wordConfidences, interimTranscript);
                return { ...stats, filler_words: finalFillerData };
            }
        } catch (err) {
            if (isMountedRef.current) {
                const error = err instanceof Error ? err : new Error(String(err));
                setError(error);
            }
        }
        return null;
    }, [isListening]);

    const reset = useCallback(() => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
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
        isListening, isReady, transcript, error, isSupported, mode: currentMode,
        chunks: finalChunks, interimTranscript, fillerData, modelLoadingProgress,
        startListening, stopListening, reset,
    };
};
