import { useState, useEffect } from 'react';

export const useBrowserSupport = () => {
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const checkSupport = () => {
      const speechSupport = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
      const mediaSupport = navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
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
