import { useState, useEffect } from 'react';

interface BrowserSupportState {
  isSupported: boolean;
  error: string | null;
}

export const useBrowserSupport = (): BrowserSupportState => {
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkSupport = () => {
      const speechSupport = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
      const mediaSupport = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      const storageSupport = typeof Storage !== 'undefined';

      const supported = speechSupport && mediaSupport && storageSupport;
      setIsSupported(supported);

      if (!supported) {
          if(!speechSupport) setError('Speech recognition not supported in this browser.');
          else if (!mediaSupport) setError('Microphone access not supported in this browser.');
          else if (!storageSupport) setError('Local storage not supported in this browser.');
      }
    };

    checkSupport();
  }, []);

  return { isSupported, error };
};
