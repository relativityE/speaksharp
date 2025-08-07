import { useState, useRef, useCallback, useEffect } from 'react'

// Filler word detection patterns moved outside the hook to prevent re-creation on each render
const fillerPatterns = {
  um: /\b(um|umm|ummm)\b/gi,
  uh: /\b(uh|uhh|uhhh|er|err|ah|a)\b/gi,
  like: /\b(like)\b/gi,
  youKnow: /\b(you know|y'know|ya know)\b/gi,
  so: /\b(so)\b/gi, // Removed lookahead to match "so" at the end of a sentence
  actually: /\b(actually)\b/gi,
  oh: /\b(oh|ooh)\b/gi
}

export const useSpeechRecognition = () => {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [fillerCounts, setFillerCounts] = useState({
    um: 0,
    uh: 0,
    like: 0,
    youKnow: 0,
    so: 0,
    actually: 0,
    oh: 0
  })
  const [error, setError] = useState(null)
  const [isSupported, setIsSupported] = useState(false)
  
  const recognitionRef = useRef(null)
  const lastProcessedLength = useRef(0)

  // Check if speech recognition is supported
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    setIsSupported(!!SpeechRecognition)
    
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition()
      recognitionRef.current.continuous = true
      recognitionRef.current.interimResults = true
      recognitionRef.current.lang = 'en-US'
    }
  }, [])

  const detectFillerWords = useCallback((text) => {
    setFillerCounts(prevCounts => {
      const updatedCounts = { ...prevCounts };
      for (const key in fillerPatterns) {
        const pattern = fillerPatterns[key];
        const matches = text.match(pattern);
        if (matches) {
          updatedCounts[key] = (updatedCounts[key] || 0) + matches.length;
        }
      }
      return updatedCounts;
    });
  }, [])

  const startListening = useCallback(() => {
    if (!isSupported || !recognitionRef.current) {
      setError('Speech recognition is not supported in this browser')
      return
    }

    try {
      setError(null)
      setIsListening(true)
      lastProcessedLength.current = 0
      
      recognitionRef.current.onresult = (event) => {
        let finalTranscriptChunk = ''
        let fullTranscript = ''

        for (let i = 0; i < event.results.length; i++) {
          const transcriptPart = event.results[i][0].transcript
          fullTranscript += transcriptPart
          if (event.results[i].isFinal && i >= event.resultIndex) {
            finalTranscriptChunk += transcriptPart
          }
        }

        setTranscript(fullTranscript)
        
        if (finalTranscriptChunk) {
          detectFillerWords(finalTranscriptChunk)
        }
      }

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error)
        setError(`Speech recognition error: ${event.error}`)
        setIsListening(false)
      }

      recognitionRef.current.onend = () => {
        setIsListening(false)
      }

      recognitionRef.current.start()
    } catch (err) {
      console.error('Error starting speech recognition:', err)
      setError('Failed to start speech recognition')
      setIsListening(false)
    }
  }, [isSupported, detectFillerWords])

  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop()
    }
  }, [isListening])

  const resetSession = useCallback(() => {
    setTranscript('')
    setFillerCounts({
      um: 0,
      uh: 0,
      like: 0,
      youKnow: 0,
      so: 0,
      actually: 0,
      oh: 0
    })
    lastProcessedLength.current = 0
    setError(null)
  }, [])

  return {
    isListening,
    transcript,
    fillerCounts,
    error,
    isSupported,
    startListening,
    stopListening,
    resetSession
  }
}
