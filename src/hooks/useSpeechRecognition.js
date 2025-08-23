import { useState, useRef, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import TranscriptionService from '../services/transcription/TranscriptionService';
import { FILLER_WORD_KEYS } from '../config';

// --- Default configurations ---
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

const getInitialFillerData = (customWords = []) => {
    const initial = {};
    const allFillerKeys = [...Object.values(FILLER_WORD_KEYS), ...customWords];
    allFillerKeys.forEach((key, index) => {
        initial[key] = { count: 0, color: FILLER_WORD_COLORS[index % FILLER_WORD_COLORS.length] };
    });
    return initial;
};

// --- The Hook ---
export const useSpeechRecognition = ({
    customWords = [],
    mode,
    model = 'Xenova/whisper-tiny.en'
} = {}) => {
    console.log(`[useSpeechRecognition] Hook initialized with mode: ${mode}, model: ${model}`);

    const { profile } = useAuth();

    // --- State Management ---
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [finalChunks, setFinalChunks] = useState([]);
    const [wordConfidences, setWordConfidences] = useState([]);
    const [interimTranscript, setInterimTranscript] = useState('');
    const [fillerData, setFillerData] = useState(getInitialFillerData(customWords));
    const [finalFillerData, setFinalFillerData] = useState(getInitialFillerData(customWords));
    const [error, setError] = useState(null);
    const [isSupported, setIsSupported] = useState(true);
    const [currentMode, setCurrentMode] = useState(mode);
    const [modelLoadingProgress, setModelLoadingProgress] = useState(null);

    const transcriptionServiceRef = useRef(null);

    // --- Service Initialization and Management ---
    // Cleanup effect to destroy the service on unmount
    useEffect(() => {
        return () => {
            if (transcriptionServiceRef.current) {
                console.log('[useSpeechRecognition] Cleanup: Destroying transcription service instance.');
                transcriptionServiceRef.current.destroy();
            }
        };
    }, []); // Empty dependency array ensures this runs only on mount and unmount

    // --- Transcript and Filler Word Processing ---
    const countFillerWords = useCallback((text) => {
        const counts = getInitialFillerData(customWords);
        const allPatterns = { ...defaultFillerPatterns };
        customWords.forEach((word) => {
            allPatterns[word] = new RegExp(`\\b(${word})\\b`, 'gi');
        });

        for (const key in allPatterns) {
            const pattern = allPatterns[key];
            const matches = text.match(pattern);
            if (matches) {
                counts[key].count = matches.length;
            }
        }
        return counts;
    }, [customWords]);

    const onModelLoadProgress = useCallback((progress) => {
        setModelLoadingProgress(progress);
    }, []);

    const onTranscriptUpdate = useCallback((data) => {
        // console.log('[useSpeechRecognition] onTranscriptUpdate:', data);
        // Don't show model loading messages in the transcript panel anymore
        if (data.transcript?.partial && !data.transcript.partial.startsWith('Downloading model')) {
            setInterimTranscript(data.transcript.partial);
        }

        if (data.transcript?.final) {
            setFinalChunks(prev => [...prev, { text: data.transcript.final, id: Math.random() }]);
            setInterimTranscript('');
        }

        if (data.words && data.words.length > 0) {
            setWordConfidences(prev => [...prev, ...data.words]);
        }
    }, []);

    useEffect(() => {
        const fullTranscript = finalChunks.map(c => c.text).join(' ') + ' ' + interimTranscript;
        const newFillerData = countFillerWords(fullTranscript);
        setFillerData(newFillerData);

        const finalTranscript = finalChunks.map(c => c.text).join(' ');
        const newFinalFillerData = countFillerWords(finalTranscript);
        setFinalFillerData(newFinalFillerData);
    }, [finalChunks, interimTranscript, customWords, countFillerWords]);

    useEffect(() => {
        const newTranscript = finalChunks.map(c => c.text).join(' ');
        setTranscript(newTranscript);
    }, [finalChunks]);

    useEffect(() => {
        if (transcriptionServiceRef.current && mode !== currentMode) {
            console.log(`[useSpeechRecognition] Mode changed from ${currentMode} to ${mode}. Updating service.`);
            transcriptionServiceRef.current.setMode(mode)
                .then(() => {
                    setCurrentMode(mode);
                    console.log('[useSpeechRecognition] Service mode updated successfully.');
                })
                .catch(err => {
                    console.error('[useSpeechRecognition] Error updating service mode:', err);
                    setError(err);
                });
        }
    }, [mode, currentMode]);

    // --- Control Functions ---
    const startListening = async () => {
        console.log('[useSpeechRecognition] startListening called.');

        if (isListening) {
            console.warn('[useSpeechRecognition] Already listening.');
            return;
        }

        try {
            setError(null);

            if (!transcriptionServiceRef.current) {
                console.log('[useSpeechRecognition] Service not initialized. Initializing now...');
                const isNativeSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
                if (mode === 'native' && !isNativeSupported) {
                    throw new Error("Native speech recognition is not supported in this browser.");
                }
                setIsSupported(true);

                const service = new TranscriptionService(mode, {
                    onTranscriptUpdate,
                    onModelLoadProgress,
                    model,
                    profile
                });
                await service.init();
                transcriptionServiceRef.current = service;
                setCurrentMode(service.mode);
                console.log(`[useSpeechRecognition] Transcription service initialized. Actual mode: ${service.mode}`);
            }

            await transcriptionServiceRef.current.startTranscription();
            setIsListening(true);
            console.log('[useSpeechRecognition] Started listening successfully.');
        } catch (err) {
            console.error('[useSpeechRecognition] Error starting speech recognition:', err);
            setError(err);
            setIsListening(false); // Ensure listening state is false on error
            setIsSupported(err.message.includes('not supported') ? false : true);
        }
    };

    const stopListening = async () => {
        console.log('[useSpeechRecognition] stopListening called.');
        if (!isListening || !transcriptionServiceRef.current) {
            console.log('[useSpeechRecognition] Not listening or service not available, cannot stop.');
            return null;
        }

        await transcriptionServiceRef.current.stopTranscription();
        setIsListening(false);
        console.log('[useSpeechRecognition] Stopped listening.');

        // Finalize transcript
        const finalTranscriptText = [...finalChunks.map(c => c.text), interimTranscript].join(' ').trim();
        const averageConfidence = wordConfidences.length > 0
            ? wordConfidences.reduce((sum, word) => sum + word.confidence, 0) / wordConfidences.length
            : 0;

        const result = {
            transcript: finalTranscriptText,
            filler_words: finalFillerData,
            total_words: finalTranscriptText.split(/\s+/).filter(Boolean).length,
            accuracy: averageConfidence,
        };
        console.log('[useSpeechRecognition] Final result:', result);
        return result;
    };

    const reset = useCallback(() => {
        console.log('[useSpeechRecognition] Resetting state.');
        setFinalChunks([]);
        setInterimTranscript('');
        setTranscript('');
        setFillerData(getInitialFillerData(customWords));
        setFinalFillerData(getInitialFillerData(customWords));
        setWordConfidences([]);
        setError(null);
    }, [customWords]);

    return {
        isListening,
        transcript,
        chunks: finalChunks,
        interimTranscript,
        fillerData,
        error,
        isSupported,
        startListening,
        stopListening,
        reset,
        mode: currentMode, // Return the *actual* current mode
        modelLoadingProgress,
    };
};
