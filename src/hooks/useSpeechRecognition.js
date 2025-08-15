import { useState, useRef, useCallback, useEffect } from 'react';
import TranscriptionService from '../services/transcription/TranscriptionService';
import { FILLER_WORD_KEYS } from '../config';

const defaultFillerPatterns = {
  [FILLER_WORD_KEYS.UM]: /\b(um|umm|ummm|ahm)\b/gi,
  [FILLER_WORD_KEYS.UH]: /\b(uh|uhh|uhhh|er|err|erh)\b/gi,
  [FILLER_WORD_KEYS.AH]: /\b(ah|a)\b/gi,
  [FILLER_WORD_KEYS.LIKE]: /\b(like)\b/gi,
  [FILLER_WORD_KEYS.YOU_KNOW]: /\b(you know|y'know|ya know)\b/gi,
  [FILLER_WORD_KEYS.SO]: /\b(so)\b/gi,
  [FILLER_WORD_KEYS.ACTUALLY]: /\b(actually)\b/gi,
  [FILLER_WORD_KEYS.OH]: /\b(oh|ooh|o)\b/gi,
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
  const [interimTranscript, setInterimTranscript] = useState('');
  const [fillerData, setFillerData] = useState(getInitialFillerData(customWords));
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('cloud'); // 'local' or 'cloud'

  const transcriptionServiceRef = useRef(null);

  const onTranscriptUpdate = useCallback((data) => {
    if (data.transcript?.partial) {
      setInterimTranscript(data.transcript.partial);
    }
    // Note: The current service providers only give partials.
    // A more robust implementation would handle final chunks and update accordingly.
  }, []);

  useEffect(() => {
    // This effect now only handles cleanup when the component unmounts.
    return () => {
      transcriptionServiceRef.current?.destroy();
    };
  }, []); // No dependencies needed anymore.

  const startListening = async () => {
    // Defer initialization until the user clicks "start".
    if (!transcriptionServiceRef.current) {
      try {
        const service = new TranscriptionService(mode, { onTranscriptUpdate });
        await service.init();
        transcriptionServiceRef.current = service;
      } catch (err) {
        console.error("Failed to initialize transcription service", err);
        setError("Failed to initialize transcription service. Please check microphone permissions.");
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
      setError('Failed to start speech recognition');
    }
  };

  const stopListening = async () => {
    if (!isListening || !transcriptionServiceRef.current) {
      return;
    }
    await transcriptionServiceRef.current.stopTranscription();
    setIsListening(false);

    const newFinalChunk = interimTranscript.trim();
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
  };

  const reset = useCallback(() => {
    setFinalChunks([]);
    setInterimTranscript('');
    setTranscript('');
    setFillerData(getInitialFillerData(customWords));
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
    isSupported: true, // Assuming the service is supported
    startListening,
    stopListening,
    reset,
    mode,
    setMode,
  };
};
