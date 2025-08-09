import { useState, useRef, useCallback, useEffect } from 'react';
import { SPEECH_RECOGNITION_LANG, FILLER_WORD_KEYS } from '../config';

const defaultFillerPatterns = {
  [FILLER_WORD_KEYS.UM]: /\b(um|umm|ummm|ahm)\b/gi,
  [FILLER_WORD_KEYS.UH]: /\b(uh|uhh|uhhh|er|err|erh)\b/gi,
  [FILLER_WORD_KEYS.AH]: /\b(ah)\b/gi,
  [FILLER_WORD_KEYS.LIKE]: /\b(like)\b/gi,
  [FILLER_WORD_KEYS.YOU_KNOW]: /\b(you know|y'know|ya know)\b/gi,
  [FILLER_WORD_KEYS.SO]: /\b(so)\b/gi,
  [FILLER_WORD_KEYS.ACTUALLY]: /\b(actually)\b/gi,
  [FILLER_WORD_KEYS.OH]: /\b(oh|ooh)\b/gi,
  [FILLER_WORD_KEYS.I_MEAN]: /\b(i mean)\b/gi,
};

const getInitialCounts = (customWords = []) => {
  const initial = {};
  Object.values(FILLER_WORD_KEYS).forEach((key) => {
    initial[key] = 0;
  });
  customWords.forEach((word) => {
    initial[word] = 0;
  });
  return initial;
};

export const useSpeechRecognition = ({ customWords = [] } = {}) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [fillerCounts, setFillerCounts] = useState(getInitialCounts(customWords));
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const intentionallyStopped = useRef(false);

  const processTranscript = useCallback((event) => {
    let finalTranscriptChunk = '';
    let fullTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcriptPart = event.results[i][0].transcript;
      fullTranscript += transcriptPart;
      if (event.results[i].isFinal) {
        finalTranscriptChunk += transcriptPart;
      }
    }
    setTranscript(prev => prev + fullTranscript);

    if (finalTranscriptChunk) {
      const allPatterns = { ...defaultFillerPatterns };
      customWords.forEach((word) => {
        allPatterns[word] = new RegExp(`\\b(${word})\\b`, 'gi');
      });

      setFillerCounts((prevCounts) => {
        const updatedCounts = { ...prevCounts };
        for (const key in allPatterns) {
          const pattern = allPatterns[key];
          const matches = finalTranscriptChunk.match(pattern);
          if (matches) {
            updatedCounts[key] = (updatedCounts[key] || 0) + matches.length;
          }
        }
        return updatedCounts;
      });
    }
  }, [customWords]);

  const handleEnd = useCallback(() => {
    if (intentionallyStopped.current) {
      setIsListening(false);
      return;
    }
    // Keep-alive: restart if not intentionally stopped
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch (err) {
        console.error('Error restarting speech recognition:', err);
        setIsListening(false);
      }
    }
  }, []);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      return;
    }

    recognitionRef.current = new SpeechRecognition();
    const recognition = recognitionRef.current;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = SPEECH_RECOGNITION_LANG;

    recognition.onresult = processTranscript;
    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      setError(`Speech recognition error: ${event.error}`);
      setIsListening(false);
    };
    recognition.onend = handleEnd;

    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
    };
  }, [processTranscript, handleEnd]);

  const startListening = useCallback(() => {
    if (isListening || !recognitionRef.current) {
      return;
    }
    try {
      setError(null);
      intentionallyStopped.current = false;
      recognitionRef.current.start();
      setIsListening(true);
    } catch (err) {
      console.error('Error starting speech recognition:', err);
      setError('Failed to start speech recognition');
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    if (!isListening || !recognitionRef.current) {
      return;
    }
    intentionallyStopped.current = true;
    recognitionRef.current.stop();
  }, [isListening]);

  const reset = useCallback(() => {
    setTranscript('');
    setFillerCounts(getInitialCounts(customWords));
    setError(null);
  }, [customWords]);

  return {
    isListening,
    transcript,
    fillerCounts,
    error,
    isSupported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    startListening,
    stopListening,
    reset,
  };
};
