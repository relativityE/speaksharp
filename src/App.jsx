import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Alert, AlertDescription } from '@/components/ui/alert.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Mic, MicOff, Play, Square, BarChart3, AlertCircle, Volume2, Plus } from 'lucide-react'
import { useAudioRecording } from './hooks/useAudioRecording'
import { useSpeechRecognition } from './hooks/useSpeechRecognition'
import { AnalyticsDashboard } from './components/AnalyticsDashboard'
import './App.css'

function App() {
  const [sessionActive, setSessionActive] = useState(false)
  const [sessionStartTime, setSessionStartTime] = useState(null)
  const [sessionDuration, setSessionDuration] = useState(0)
  const [customWord, setCustomWord] = useState("")
  const [customWords, setCustomWords] = useState([])
  const [isLoggedIn, setIsLoggedIn] = useState(false) // Mock login state

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
  } = useSpeechRecognition({ customWords })

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

  const handleAddCustomWord = () => {
    const newWord = customWord.trim().toLowerCase()
    if (newWord && !customWords.includes(newWord)) {
      setCustomWords([newWord])
      setCustomWord("")
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

  const handleLogin = () => setIsLoggedIn(true)
  const handleLogout = () => setIsLoggedIn(false)

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <div className="text-left">
            <h1 className="text-4xl font-bold">SayLess</h1>
          </div>
          <div>
            {isLoggedIn ? (
              <Button onClick={handleLogout} variant="outline">Logout</Button>
            ) : (
              <Button onClick={handleLogin}>Simulate Login</Button>
            )}
          </div>
        </header>

        {isLoggedIn ? (
          <AnalyticsDashboard />
        ) : (
          <>
            <div className="text-center mb-4">
              <p className="text-xl text-muted-foreground">Real-time filler word detection for better speaking</p>
              {!isSupported && (
                <Alert className="mt-4 max-w-2xl mx-auto">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Speech recognition is not supported in this browser. Audio recording will work, but real-time filler word detection requires Chrome, Edge, or Safari.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {error && (
              <Alert className="mb-6 max-w-2xl mx-auto" variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

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
                <div className="text-center p-4 bg-teal-50 rounded-lg">
                  <div className="text-2xl font-bold text-teal-600">{fillerCounts.oh}</div>
                  <div className="text-sm text-gray-600">Oh</div>
                </div>
                <div className="text-center p-4 bg-cyan-50 rounded-lg">
                  <div className="text-2xl font-bold text-cyan-600">{fillerCounts.iMean}</div>
                  <div className="text-sm text-gray-600">I Mean</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

            {sessionActive && (
              <>
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

                <Card className="mb-6">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="h-5 w-5" />
                      Filler Word Detection
                    </CardTitle>
                    <CardDescription>
                      Real-time tracking of common filler words. Add your own word to track below.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                      <div className="text-center p-4 bg-teal-50 rounded-lg">
                        <div className="text-2xl font-bold text-teal-600">{fillerCounts.oh}</div>
                        <div className="text-sm text-gray-600">Oh</div>
                      </div>
                      <div className="text-center p-4 bg-cyan-50 rounded-lg">
                        <div className="text-2xl font-bold text-cyan-600">{fillerCounts.iMean}</div>
                        <div className="text-sm text-gray-600">I Mean</div>
                      </div>
                      {customWords.map((word) => (
                        <div key={word} className="text-center p-4 bg-gray-100 rounded-lg">
                          <div className="text-2xl font-bold text-gray-800">{fillerCounts[word] || 0}</div>
                          <div className="text-sm text-gray-600 capitalize">{word}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-6 flex w-full max-w-sm items-center space-x-2 mx-auto">
                      <Input
                        type="text"
                        placeholder="Add custom word..."
                        value={customWord}
                        onChange={(e) => setCustomWord(e.target.value)}
                        disabled={!sessionActive || customWords.length > 0}
                      />
                      <Button
                        type="button"
                        onClick={handleAddCustomWord}
                        disabled={!sessionActive || !customWord || customWords.length > 0}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Word
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {transcript && (
                  <Card className="mb-6">
                    <CardHeader>
                      <CardTitle className="text-lg">Live Transcript</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="bg-gray-50 p-4 rounded-lg max-h-40 overflow-y-auto">
                        <p className="text-sm text-gray-700 leading-relaxed">
                          {transcript}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </>
        )}
        <footer className="text-center text-gray-500 text-sm mt-8">
          <p>SayLess - Powered by browser-based speech recognition</p>
        </footer>
      </div>
    </div>
  )
}

export default App
