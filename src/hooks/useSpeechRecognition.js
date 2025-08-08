import { useState, useRef, useCallback, useEffect } from 'react';
import { SPEECH_RECOGNITION_LANG, FILLER_WORD_KEYS } from '../config';

const defaultFillerPatterns = {
  [FILLER_WORD_KEYS.UM]: /\b(um|umm|ummm|ahm|am|em)\b/gi,
  [FILLER_WORD_KEYS.UH]: /\b(uh|uhh|uhhh|er|err|a|erh)\b/gi,
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
  const [isSupported, setIsSupported] = useState(false);

  const recognitionRef = useRef(null);
  const intentionallyStopped = useRef(false);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognition);

    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = SPEECH_RECOGNITION_LANG;
    }
  }, []);

  const detectFillerWords = useCallback((text) => {
      const allPatterns = { ...defaultFillerPatterns };
      customWords.forEach((word) => {
        allPatterns[word] = new RegExp(`\\b(${word})\\b`, 'gi');
      });

      setFillerCounts((prevCounts) => {
        const updatedCounts = { ...prevCounts };
        for (const key in allPatterns) {
          const pattern = allPatterns[key];
          const matches = text.match(pattern);
          if (matches) {
            updatedCounts[key] = (updatedCounts[key] || 0) + matches.length;
          }
        }
        return updatedCounts;
      });
    }, [customWords]
  );

  const startListening = useCallback(() => {
    if (!isSupported || !recognitionRef.current || isListening) {
      return;
    }

    try {
      setError(null);
      setIsListening(true);
      intentionallyStopped.current = false;

      recognitionRef.current.onresult = (event) => {
        let finalTranscriptChunk = '';
        let fullTranscript = '';

        for (let i = 0; i < event.results.length; i++) {
          const transcriptPart = event.results[i][0].transcript;
          fullTranscript += transcriptPart;
          if (event.results[i].isFinal && i >= event.resultIndex) {
            finalTranscriptChunk += transcriptPart;
          }
        }

        setTranscript(fullTranscript);
        if (finalTranscriptChunk) {
          detectFillerWords(finalTranscriptChunk);
        }
      };

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setError(`Speech recognition error: ${event.error}`);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        if (intentionallyStopped.current) {
          setIsListening(false);
        } else {
          // This is the "keep-alive" logic. If the service stops on its own, restart it.
          try {
            recognitionRef.current.start();
          } catch (err) {
            console.error('Error restarting speech recognition:', err);
            setIsListening(false);
          }
        }
      };

      recognitionRef.current.start();
    } catch (err) {
      console.error('Error starting speech recognition:', err);
      setError('Failed to start speech recognition');
      setIsListening(false);
    }
  }, [isSupported, isListening, detectFillerWords]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      intentionallyStopped.current = true;
      recognitionRef.current.stop();
    }
  }, [isListening]);

  const resetSession = useCallback(() => {
    setTranscript('');
    setFillerCounts(getInitialCounts(customWords));
    setError(null);
  }, [customWords]);

  return {
    isListening,
    transcript,
    fillerCounts,
    error,
    isSupported,
    startListening,
    stopListening,
    resetSession,
  };
};
