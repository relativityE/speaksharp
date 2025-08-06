import { useState, useRef, useCallback, useEffect } from 'react'

export const useSpeechRecognition = () => {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [fillerCounts, setFillerCounts] = useState({
    um: 0,
    uh: 0,
    like: 0,
    youKnow: 0,
    so: 0,
    actually: 0
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

  // Filler word detection patterns
  const fillerPatterns = {
    um: /\b(um|umm|ummm)\b/gi,
    uh: /\b(uh|uhh|uhhh|er|err)\b/gi,
    like: /\b(like)\b/gi,
    youKnow: /\b(you know|y'know|ya know)\b/gi,
    so: /\b(so)\b(?=\s)/gi, // 'so' followed by space to avoid words like 'also'
    actually: /\b(actually)\b/gi
  }

  const detectFillerWords = useCallback((text) => {
    const newCounts = {};
    for (const key in fillerPatterns) {
      const pattern = fillerPatterns[key];
      const matches = text.match(pattern);
      newCounts[key] = matches ? matches.length : 0;
    }
    setFillerCounts(newCounts);
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
        let finalTranscript = ''
        let interimTranscript = ''

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript
          if (event.results[i].isFinal) {
            finalTranscript += transcript
          } else {
            interimTranscript += transcript
          }
        }

        const fullTranscript = finalTranscript + interimTranscript
        setTranscript(fullTranscript)
        
        // Only process new text for filler word detection
        if (finalTranscript) {
          detectFillerWords(finalTranscript)
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
      setIsListening(false)
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
      actually: 0
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

