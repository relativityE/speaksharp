import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Alert, AlertDescription } from '@/components/ui/alert.jsx'
import { Mic, MicOff, Play, Square, BarChart3, AlertCircle, Volume2 } from 'lucide-react'
import { useAudioRecording } from './hooks/useAudioRecording'
import { useSpeechRecognition } from './hooks/useSpeechRecognition'
import './App.css'

function App() {
  const [sessionActive, setSessionActive] = useState(false)
  const [sessionStartTime, setSessionStartTime] = useState(null)
  const [sessionDuration, setSessionDuration] = useState(0)

  // Audio recording hook
  const {
    isRecording,
    audioBlob,
    error: audioError,
    startRecording,
    stopRecording,
    clearRecording
  } = useAudioRecording()

  // Speech recognition hook
  const {
    isListening,
    transcript,
    fillerCounts,
    error: speechError,
    isSupported,
    startListening,
    stopListening,
    resetSession
  } = useSpeechRecognition()

  // Session timer
  useEffect(() => {
    let interval = null
    if (sessionActive && sessionStartTime) {
      interval = setInterval(() => {
        setSessionDuration(Math.floor((Date.now() - sessionStartTime) / 1000))
      }, 1000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [sessionActive, sessionStartTime])

  const handleStartSession = () => {
    setSessionActive(true)
    setSessionStartTime(Date.now())
    setSessionDuration(0)
    resetSession()
    clearRecording()
  }

  const handleEndSession = () => {
    setSessionActive(false)
    setSessionStartTime(null)
    setSessionDuration(0)
    if (isRecording) stopRecording()
    if (isListening) stopListening()
  }

  const handleToggleRecording = async () => {
    if (isRecording) {
      stopRecording()
      stopListening()
    } else {
      await startRecording()
      if (isSupported) {
        startListening()
      }
    }
  }

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const getTotalFillerWords = () => {
    return Object.values(fillerCounts).reduce((sum, count) => sum + count, 0)
  }

  const error = audioError || speechError

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-center mb-2">SayLess</h1>
          <p className="text-xl text-muted-foreground text-center mb-8">Real-time filler word detection for better speaking</p>
          
          {!isSupported && (
            <Alert className="mt-4 max-w-2xl mx-auto">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Speech recognition is not supported in this browser. Audio recording will work, but real-time filler word detection requires Chrome, Edge, or Safari.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <Alert className="mb-6 max-w-2xl mx-auto" variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Main Control Panel */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mic className="h-5 w-5" />
              Session Control
              {sessionActive && (
                <Badge variant="outline" className="ml-auto">
                  {formatTime(sessionDuration)}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Start a new session to begin tracking your speech patterns
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 justify-center">
              {!sessionActive ? (
                <Button onClick={handleStartSession} size="lg" className="bg-green-600 hover:bg-green-700">
                  <Play className="h-4 w-4 mr-2" />
                  Start New Session
                </Button>
              ) : (
                <>
                  <Button 
                    onClick={handleToggleRecording} 
                    size="lg" 
                    variant={isRecording ? "destructive" : "default"}
                    disabled={!sessionActive}
                  >
                    {isRecording ? (
                      <>
                        <MicOff className="h-4 w-4 mr-2" />
                        Stop Recording
                      </>
                    ) : (
                      <>
                        <Mic className="h-4 w-4 mr-2" />
                        Start Recording
                      </>
                    )}
                  </Button>
                  <Button onClick={handleEndSession} variant="outline" size="lg">
                    <Square className="h-4 w-4 mr-2" />
                    End Session
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recording Status */}
        {sessionActive && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="text-center space-y-2">
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${
                  isRecording ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'
                }`}>
                  <div className={`w-3 h-3 rounded-full ${
                    isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-400'
                  }`}></div>
                  {isRecording ? 'Recording...' : 'Ready to Record'}
                </div>
                
                {isSupported && isListening && (
                  <div className="flex items-center justify-center gap-2 text-sm text-blue-600">
                    <Volume2 className="h-4 w-4" />
                    Speech recognition active
                  </div>
                )}
                
                {sessionActive && (
                  <div className="text-sm text-gray-600">
                    Total filler words detected: <span className="font-semibold">{getTotalFillerWords()}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filler Word Counters */}
        {sessionActive && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Filler Word Detection
                {!isSupported && (
                  <Badge variant="secondary" className="text-xs">
                    Manual Mode
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                {isSupported 
                  ? "Real-time tracking of common filler words" 
                  : "Filler word counts (requires manual input in this browser)"
                }
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="text-center p-4 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{fillerCounts.um}</div>
                  <div className="text-sm text-gray-600">Um</div>
                </div>
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{fillerCounts.uh}</div>
                  <div className="text-sm text-gray-600">Uh</div>
                </div>
                <div className="text-center p-4 bg-yellow-50 rounded-lg">
                  <div className="text-2xl font-bold text-yellow-600">{fillerCounts.like}</div>
                  <div className="text-sm text-gray-600">Like</div>
                </div>
                <div className="text-center p-4 bg-purple-50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">{fillerCounts.youKnow}</div>
                  <div className="text-sm text-gray-600">You Know</div>
                </div>
                <div className="text-center p-4 bg-orange-50 rounded-lg">
                  <div className="text-2xl font-bold text-orange-600">{fillerCounts.so}</div>
                  <div className="text-sm text-gray-600">So</div>
                </div>
                <div className="text-center p-4 bg-pink-50 rounded-lg">
                  <div className="text-2xl font-bold text-pink-600">{fillerCounts.actually}</div>
                  <div className="text-sm text-gray-600">Actually</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Live Transcript */}
        {sessionActive && isSupported && transcript && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">Live Transcript</CardTitle>
              <CardDescription>
                Real-time speech-to-text transcription
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-gray-50 p-4 rounded-lg max-h-40 overflow-y-auto">
                <p className="text-sm text-gray-700 leading-relaxed">
                  {transcript || "Start speaking to see your transcript..."}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Features Overview */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Privacy First</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">All processing happens on your device using browser APIs. Your speech never leaves your device.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Real-time Feedback</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">Get instant feedback on your speech patterns to improve your communication skills.</p>
            </CardContent>
          </Card>
        </div>

        {/* Footer */}
        <div className="text-center text-gray-500 text-sm">
          <p>SayLess - Powered by browser-based speech recognition</p>
        </div>
      </div>
    </div>
  )
}

export default App
