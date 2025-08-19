import { useState, useRef, useCallback, useEffect } from 'react';
import TranscriptionService from '../services/transcription/TranscriptionService';
import { FILLER_WORD_KEYS } from '../config';

const defaultFillerPatterns = {
  [FILLER_WORD_KEYS.UM]: /\b(um|umm|ummm|ahm)\b/gi,
  [FILLER_WORD_KEYS.UH]: /\b(uh|uhh|uhhh|er|err|erh)\b/gi,
  [FILLER_WORD_KEYS.AH]: /\bah\b/gi,
  [FILLER_WORD_KEYS.LIKE]: /\b(like)\b/gi,
  [FILLER_WORD_KEYS.YOU_KNOW]: /\b(you know|y'know|ya know)\b/gi,
  [FILLER_WORD_KEYS.SO]: /\b(so)\b/gi,
  [FILLER_WORD_KEYS.ACTUALLY]: /\b(actually)\b/gi,
  [FILLER_WORD_KEYS.OH]: /\b(oh|ooh)\b/gi,
  [FILLER_WORD_KEYS.I_MEAN]: /\b(i mean)\b/gi,
};

const FILLER_WORD_COLORS = [
  '#BFDBFE', // blue-200
  '#FCA5A5', // red-400
  '#FDE68A', // amber-200
  '#86EFAC', // green-300
  '#FDBA74', // orange-300
  '#C4B5FD', // violet-300
  '#6EE7B7', // teal-300
];

const getInitialFillerData = (customWords = []) => {
  const initial = {};
  const allFillerKeys = [...Object.values(FILLER_WORD_KEYS), ...customWords];
  allFillerKeys.forEach((key, index) => {
    initial[key] = {
      count: 0,
      color: FILLER_WORD_COLORS[index % FILLER_WORD_COLORS.length]
    };
  });
  return initial;
};

export const useSpeechRecognition = ({ customWords = [] } = {}) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [finalChunks, setFinalChunks] = useState([]);
  const [wordConfidences, setWordConfidences] = useState([]);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [fillerData, setFillerData] = useState(getInitialFillerData(customWords));
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('cloud'); // 'local' or 'cloud' or 'native'
  const transcriptionServiceRef = useRef(null);
  const [isSupported, setIsSupported] = useState(true);

  useEffect(() => {
    const checkSupport = () => {
      const isNativeSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      if (mode === 'native' && !isNativeSupported) {
        setError("Native speech recognition is not supported in this browser.");
        setIsSupported(false);
        return false;
      }
      // For 'cloud' and 'local', we assume support is available until an error occurs during initialization.
      setIsSupported(true);
      return true;
    };

    checkSupport();

    // Cleanup on unmount
    return () => {
      transcriptionServiceRef.current?.destroy();
    };
  }, [mode]);


  const processFinalChunk = useCallback((finalChunk) => {
    const newFinalChunk = finalChunk.trim();
    if (newFinalChunk) {
      setFinalChunks(prev => [...prev, { text: newFinalChunk, id: Math.random() }]);

      const allPatterns = { ...defaultFillerPatterns };
      customWords.forEach((word) => {
          allPatterns[word] = new RegExp(`\\b(${word})\\b`, 'gi');
      });
      setFillerData((prevData) => {
          const newData = { ...prevData };
          let changed = false;
          for (const key in allPatterns) {
              const pattern = allPatterns[key];
              const matches = newFinalChunk.match(pattern);
              if (matches && matches.length > 0) {
                  if (!newData[key]) {
                      const newIndex = Object.keys(newData).length;
                      newData[key] = { count: 0, color: FILLER_WORD_COLORS[newIndex % FILLER_WORD_COLORS.length] };
                  }
                  newData[key] = { ...newData[key], count: newData[key].count + matches.length };
                  changed = true;
              }
          }
          return changed ? newData : prevData;
      });
    }
    setInterimTranscript('');
  }, [customWords]);

  const onTranscriptUpdate = useCallback((data) => {
    if (data.transcript?.partial) {
      setInterimTranscript(data.transcript.partial);
    }
    if (data.transcript?.final) {
      processFinalChunk(data.transcript.final);
    }
    if (data.words && data.words.length > 0) {
        setWordConfidences(prev => [...prev, ...data.words]);
    }
  }, [processFinalChunk]);

  const startListening = async () => {
    if (!isSupported) {
      setError("Speech recognition is not supported on this device or browser.");
      return;
    }

    if (!transcriptionServiceRef.current) {
      try {
        const service = new TranscriptionService(mode, { onTranscriptUpdate });
        await service.init();
        transcriptionServiceRef.current = service;
        // After init, the service might have fallen back to native.
        // Update the mode to reflect the actual service mode.
        if (service.mode !== mode) {
          setMode(service.mode);
        }
      } catch (err) {
        console.error("Failed to initialize transcription service", err);
        setError(err);
        setIsSupported(false);
        return;
      }
    }

    if (isListening) {
      return;
    }

    try {
      setError(null);
      await transcriptionServiceRef.current.startTranscription();
      setIsListening(true);
    } catch (err) {
      console.error('Error starting speech recognition:', err);
      setError(err);
    }
  };

  const stopListening = async () => {
    if (!isListening || !transcriptionServiceRef.current) {
      return null;
    }
    await transcriptionServiceRef.current.stopTranscription();
    setIsListening(false);

    // Process the final chunk to ensure the UI updates correctly
    processFinalChunk(interimTranscript);

    // Manually calculate the final data to return immediately,
    // without waiting for the next render cycle.
    const newFinalChunkText = interimTranscript.trim();
    const allFinalChunks = [...finalChunks.map(c => c.text), newFinalChunkText].filter(Boolean);
    const finalTranscript = allFinalChunks.join(' ');

    const finalFillerData = JSON.parse(JSON.stringify(fillerData)); // Deep copy
    const allPatterns = { ...defaultFillerPatterns };
    customWords.forEach((word) => {
        allPatterns[word] = new RegExp(`\\b(${word})\\b`, 'gi');
    });

    for (const key in allPatterns) {
        const pattern = allPatterns[key];
        const matches = newFinalChunkText.match(pattern);
        if (matches && matches.length > 0) {
            if (!finalFillerData[key]) {
                 const newIndex = Object.keys(finalFillerData).length;
                 finalFillerData[key] = { count: 0, color: FILLER_WORD_COLORS[newIndex % FILLER_WORD_COLORS.length] };
            }
            finalFillerData[key].count += matches.length;
        }
    }

    const averageConfidence = wordConfidences.length > 0
      ? wordConfidences.reduce((sum, word) => sum + word.confidence, 0) / wordConfidences.length
      : 0;

    return {
      transcript: finalTranscript,
      filler_words: finalFillerData,
      total_words: finalTranscript.split(/\s+/).filter(Boolean).length,
      accuracy: averageConfidence,
    };
  };

  const reset = useCallback(() => {
    setFinalChunks([]);
    setInterimTranscript('');
    setTranscript('');
    setFillerData(getInitialFillerData(customWords));
    setWordConfidences([]);
    setError(null);
  }, [customWords]);

  useEffect(() => {
    const newTranscript = finalChunks.map(c => c.text).join('');
    setTranscript(newTranscript);
  }, [finalChunks]);

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
    mode,
    setMode,
  };
};
