import { useState, useEffect } from 'react';

export const useBrowserSupport = () => {
  const [support, setSupport] = useState({
    speechRecognition: false,
    mediaDevices: false,
    localStorage: false,
    error: null
  })

  useEffect(() => {
    const checkSupport = () => {
      const speechSupport = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
      const mediaSupport = navigator.mediaDevices && navigator.mediaDevices.getUserMedia
      const storageSupport = typeof Storage !== 'undefined'

      setSupport({
        speechRecognition: speechSupport,
        mediaDevices: mediaSupport,
        localStorage: storageSupport,
        error: !speechSupport ? 'Speech recognition not supported in this browser' : null
      })
    }

    checkSupport()
  }, [])

  return support
}
