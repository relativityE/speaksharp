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

  const handleTranscriptUpdate = useCallback(({ transcript: newTranscript, isFinal }) => {
    if (isFinal) {
      setFinalChunks(prev => [...prev, { text: newTranscript.slice(transcript.length), id: prev.length }]);
      setInterimTranscript('');
    } else {
      setInterimTranscript(newTranscript.slice(transcript.length));
    }
  }, [transcript]);

  useEffect(() => {
    // This effect now only handles cleanup when the component unmounts.
    return () => {
      transcriptionServiceRef.current?.destroy();
    };
  }, []);

  const processFillerWords = useCallback((text) => {
    const allPatterns = { ...defaultFillerPatterns };
    customWords.forEach((word) => {
        allPatterns[word] = new RegExp(`\\b(${word})\\b`, 'gi');
    });
    setFillerData((prevData) => {
        const newData = { ...prevData };
        let changed = false;
        for (const key in allPatterns) {
            const pattern = allPatterns[key];
            const matches = text.match(pattern);
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
  }, [customWords]);

  const startListening = async () => {
    if (isListening) return;

    try {
      setError(null);
      const ServiceToUse = (typeof window !== 'undefined' && window.MockTranscriptionService) || TranscriptionService;
      const service = new ServiceToUse(mode, { onUpdate: handleTranscriptUpdate });
      await service.init();
      transcriptionServiceRef.current = service;

      await service.startTranscription();
      setIsListening(true);
    } catch (err) {
      console.error("Failed to initialize or start transcription service", err);
      setError("Failed to start speech recognition. Please check microphone permissions.");
    }
  };

  const stopListening = async () => {
    if (!isListening || !transcriptionServiceRef.current) return;

    await transcriptionServiceRef.current.stopTranscription();
    setIsListening(false);
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
    if (newTranscript !== transcript) {
      setTranscript(newTranscript);
      processFillerWords(newTranscript);
    }
  }, [finalChunks, transcript, processFillerWords]);

  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported(
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      !!navigator.mediaDevices.getUserMedia
    );
  }, []);

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
