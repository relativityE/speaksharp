import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import TranscriptionService from '../services/transcription/TranscriptionService';
import { FILLER_WORD_KEYS } from '../config';
import logger from '../lib/logger';
import {
    createInitialFillerData,
    countFillerWords,
    calculateTranscriptStats,
    limitArray
} from '../utils/fillerWordUtils';

const MAX_CHUNKS = 1000;
const MAX_WORD_CONFIDENCES = 5000;

export const useSpeechRecognition = ({
    customWords = [],
    session,
    profile,
} = {}) => {
    const { session: authSession } = useAuth();
    const navigate = useNavigate();

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
    const debounceTimerRef = useRef(null);
    const stateRef = useRef({ finalChunks: [], wordConfidences: [], interimTranscript: '', finalFillerData: initialFillerData });

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

    const onModelLoadProgress = useCallback((progress) => {
        if (isMountedRef.current) setModelLoadingProgress(progress);
    }, []);

    const handleReady = useCallback(() => {
        if (typeof window !== 'undefined' && window.__E2E_MODE__) {
            window.__TRANSCRIPTION_READY__ = true;
        }
        if (isMountedRef.current) setIsReady(true);
    }, []);

    const onTranscriptUpdate = useCallback((data) => {
        if (!isMountedRef.current) return;
        if (data.transcript?.partial && !data.transcript.partial.startsWith('Downloading model')) {
            setInterimTranscript(data.transcript.partial);
        }
        if (data.transcript?.final) {
            setFinalChunks(prev => limitArray([...prev, { text: data.transcript.final, id: Date.now() + Math.random() }], MAX_CHUNKS));
            setInterimTranscript('');
        }
        if (data.words && data.words.length > 0) {
            setWordConfidences(prev => limitArray([...prev, ...data.words], MAX_WORD_CONFIDENCES));
        }
    }, []);

    const debouncedCountFillerWords = useCallback((text, callback) => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
            if (isMountedRef.current) {
                try {
                    const result = countFillerWords(text, customWords);
                    callback(result);
                } catch (err) {
                    logger.error({ err }, 'Error counting filler words');
                }
            }
        }, 50);
    }, [customWords]);

    useEffect(() => {
        const fullTranscript = finalChunks.map(c => c.text).join(' ') + ' ' + interimTranscript;
        const finalTranscriptOnly = finalChunks.map(c => c.text).join(' ');
        debouncedCountFillerWords(fullTranscript, setFillerData);
        setFinalFillerData(countFillerWords(finalTranscriptOnly, customWords));
        setTranscript(finalTranscriptOnly);
    }, [finalChunks, interimTranscript, debouncedCountFillerWords, customWords]);

    const getAssemblyAIToken = useCallback(async () => {
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
            logger.error({ err }, "Error getting AssemblyAI token");
            if (isMountedRef.current) toast.error("Unable to start transcription: " + err.message);
            return null;
        }
    }, [authSession]);

    const startListening = useCallback(async ({ forceCloud = false, forceOnDevice = false, forceNative = false } = {}) => {
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

            const service = new TranscriptionService({
                onTranscriptUpdate, onModelLoadProgress, onReady: handleReady,
                profile, forceCloud, forceOnDevice, forceNative, session, navigate, getAssemblyAIToken,
            });

            transcriptionServiceRef.current = service;
            await service.init();
            if (!isMountedRef.current) return;

            await service.startTranscription();
            if (isMountedRef.current) setCurrentMode(service.mode);
        } catch (err) {
            if (isMountedRef.current) {
                setError(err);
                setIsListening(false);
                if (err.message.toLowerCase().includes('permission denied')) {
                    setIsSupported(false);
                }
            }
        } finally {
            initializationStateRef.current.isInitializing = false;
        }
    }, [isListening, profile, session, navigate, getAssemblyAIToken, onTranscriptUpdate, onModelLoadProgress, handleReady]);

    const stopListening = useCallback(async () => {
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
            if (isMountedRef.current) setError(err);
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
