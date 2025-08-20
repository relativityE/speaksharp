import { useState, useRef, useCallback, useEffect } from 'react';
import TranscriptionService from '../services/transcription/TranscriptionService';
import { FILLER_WORD_KEYS, defaultFillerPatterns } from '../config';

// --- Default configurations ---

const FILLER_WORD_COLORS = ['#BFDBFE', '#FCA5A5', '#FDE68A', '#86EFAC', '#FDBA74', '#C4B5FD', '#6EE7B7'];

const getInitialFillerData = (customWords = [], fillerPatterns = {}) => {
    const initial = {};
    const allFillerKeys = [
        ...Object.values(FILLER_WORD_KEYS),
        ...customWords,
        ...Object.keys(fillerPatterns),
    ];
    // Use a Set to get unique keys, then convert back to an array
    const uniqueKeys = [...new Set(allFillerKeys)];
    uniqueKeys.forEach((key, index) => {
        initial[key] = { count: 0, color: FILLER_WORD_COLORS[index % FILLER_WORD_COLORS.length] };
    });
    return initial;
};

// --- The Hook ---
export const useSpeechRecognition = ({
    customWords = [],
    fillerPatterns = {}, // Allow custom filler patterns
    initialMode = 'cloud', // Default to 'cloud'
    model = 'Xenova/whisper-tiny.en' // Make model a prop for local mode
} = {}) => {
    console.log(`[useSpeechRecognition] Hook initialized with initialMode: ${initialMode}, model: ${model}`);

    // --- State Management ---
    const [mode, setMode] = useState(initialMode);
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [finalChunks, setFinalChunks] = useState([]);
    const [wordConfidences, setWordConfidences] = useState([]);
    const [interimTranscript, setInterimTranscript] = useState('');
    const [fillerData, setFillerData] = useState(() => getInitialFillerData(customWords, fillerPatterns));
    const [finalFillerData, setFinalFillerData] = useState(() => getInitialFillerData(customWords, fillerPatterns));
    const [error, setError] = useState(null);
    const [isSupported, setIsSupported] = useState(true);
    const [currentMode, setCurrentMode] = useState(mode);

    const transcriptionServiceRef = useRef(null);

    // --- Service Initialization and Management ---
    useEffect(() => {
        console.log(`[useSpeechRecognition] Effect to initialize service for mode: ${mode}`);

        const initializeService = async () => {
            // 1. Cleanup previous instance if it exists
            if (transcriptionServiceRef.current) {
                console.log('[useSpeechRecognition] Destroying previous transcription service instance.');
                transcriptionServiceRef.current.destroy();
                transcriptionServiceRef.current = null;
            }

            // 2. Check for native support if requested
            const isNativeSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
            if (mode === 'native' && !isNativeSupported) {
                console.error('[useSpeechRecognition] Native speech recognition not supported.');
                setError("Native speech recognition is not supported in this browser.");
                setIsSupported(false);
                return;
            }
            setIsSupported(true);
            setError(null);

            // 3. Create and initialize the new service instance
            try {
                console.log(`[useSpeechRecognition] Creating TranscriptionService with mode: ${mode}`);
                const service = new TranscriptionService(mode, {
                    onTranscriptUpdate,
                    model // Pass model to the service
                });
                await service.init();
                transcriptionServiceRef.current = service;
                setCurrentMode(service.mode); // Reflect the actual mode used (e.g., fallback)
                console.log(`[useSpeechRecognition] Transcription service initialized. Actual mode: ${service.mode}`);
            } catch (err) {
                console.error("[useSpeechRecognition] Failed to initialize transcription service:", err);
                setError(err);
                setIsSupported(false);
            }
        };

        initializeService();

        // 4. Cleanup on unmount or when mode/model changes
        return () => {
            if (transcriptionServiceRef.current) {
                console.log('[useSpeechRecognition] Cleanup: Destroying transcription service instance.');
                transcriptionServiceRef.current.destroy();
            }
        };
    }, [mode, model]); // Re-run this effect if the mode or model prop changes

    // --- Transcript and Filler Word Processing ---
    const countFillerWords = useCallback((text) => {
        const counts = getInitialFillerData(customWords, fillerPatterns);
        // Merge default patterns with custom ones, with custom ones taking precedence
        const allPatterns = { ...defaultFillerPatterns, ...fillerPatterns };

        // Add patterns for simple custom words if they don't have a custom pattern
        customWords.forEach((word) => {
            if (!allPatterns[word]) {
                allPatterns[word] = new RegExp(`\\b(${word})\\b`, 'gi');
            }
        });

        for (const key in allPatterns) {
            // Ensure the key exists in counts before processing
            if (counts[key]) {
                const pattern = allPatterns[key];
                const matches = text.match(pattern);
                if (matches) {
                    counts[key].count = matches.length;
                }
            }
        }
        return counts;
    }, [customWords, fillerPatterns]);

    const onTranscriptUpdate = useCallback((data) => {
        // console.log('[useSpeechRecognition] onTranscriptUpdate:', data);
        if (data.transcript?.partial) {
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

    // --- Control Functions ---
    const startListening = async () => {
        console.log('[useSpeechRecognition] startListening called.');
        if (!isSupported || !transcriptionServiceRef.current) {
            const message = `Cannot start listening. Supported: ${isSupported}, Service ready: ${!!transcriptionServiceRef.current}`;
            console.error(`[useSpeechRecognition] ${message}`);
            setError(message);
            return;
        }

        if (isListening) {
            console.warn('[useSpeechRecognition] Already listening.');
            return;
        }

        try {
            setError(null);
            await transcriptionServiceRef.current.startTranscription();
            setIsListening(true);
            console.log('[useSpeechRecognition] Started listening successfully.');
        } catch (err) {
            console.error('[useSpeechRecognition] Error starting speech recognition:', err);
            setError(err);
        }
    };

    const stopListening = async () => {
        console.log('[useSpeechRecognition] stopListening called.');
        if (!isListening || !transcriptionServiceRef.current) {
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
        setFillerData(getInitialFillerData(customWords, fillerPatterns));
        setFinalFillerData(getInitialFillerData(customWords, fillerPatterns));
        setWordConfidences([]);
        setError(null);
    }, [customWords, fillerPatterns]);

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
        setMode, // Return the setter
    };
};
