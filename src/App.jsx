import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle } from 'lucide-react'
import { useAudioRecording } from '@/hooks/useAudioRecording'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { AnalyticsDashboard } from '@/components/AnalyticsDashboard'
import { SessionControl } from '@/components/SessionControl'
import { RecordingStatus } from '@/components/RecordingStatus'
import { FillerWordCounters } from '@/components/FillerWordCounters'
import { ErrorDisplay } from '@/components/ErrorDisplay'
import './App.css'

function App() {
  const [sessionActive, setSessionActive] = useState(false)
  const [sessionStartTime, setSessionStartTime] = useState(null)
  const [sessionDuration, setSessionDuration] = useState(0)
  const [customWord, setCustomWord] = useState("")
  const [customWords, setCustomWords] = useState([])
  const [viewMode, setViewMode] = useState('session') // 'session' or 'analytics'

  const {
    isRecording,
    error: audioError,
    startRecording,
    stopRecording,
    clearRecording
  } = useAudioRecording()

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
    setCustomWords([])
    resetSession()
    clearRecording()
    setViewMode('session')
  }

  const handleEndSession = () => {
    setSessionActive(false)
    setSessionStartTime(null)
    setSessionDuration(0)
    if (isRecording) stopRecording()
    if (isListening) stopListening()
    setViewMode('session')
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

  const handleViewAnalytics = () => setViewMode('analytics')
  const handleViewSession = () => setViewMode('session')

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <div className="text-left">
            <h1 className="text-4xl font-bold">SayLess</h1>
          </div>
          <div>
            {sessionActive && viewMode === 'session' && (
              <Button onClick={handleViewAnalytics}>Analytics</Button>
            )}
            {viewMode === 'analytics' && (
              <Button onClick={handleViewSession} variant="outline">Back to Session</Button>
            )}
          </div>
        </header>

        {viewMode === 'analytics' ? (
          <AnalyticsDashboard
            fillerCounts={fillerCounts}
            sessionDuration={sessionDuration}
            transcript={transcript}
          />
        ) : (
          <>
            <div className="text-center mb-4">
              <p className="text-xl text-muted-foreground">Real-time filler word detection for better speaking</p>
              {!isSupported && (
                <Alert className="mt-4 max-w-2xl mx-auto">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Speech recognition is not supported in this browser.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <ErrorDisplay error={error} />

            <SessionControl
              sessionActive={sessionActive}
              isRecording={isRecording}
              sessionDuration={sessionDuration}
              onStartSession={handleStartSession}
              onEndSession={handleEndSession}
              onToggleRecording={handleToggleRecording}
              formatTime={formatTime}
            />

            {sessionActive && (
              <>
                <RecordingStatus
                  isRecording={isRecording}
                  isListening={isListening}
                  isSupported={isSupported}
                  totalFillerWords={getTotalFillerWords()}
                />
                <FillerWordCounters
                  fillerCounts={fillerCounts}
                  customWords={customWords}
                  customWord={customWord}
                  setCustomWord={setCustomWord}
                  onAddCustomWord={handleAddCustomWord}
                  isSupported={isSupported}
                  sessionActive={sessionActive}
                />
                {transcript && (
                  <Card className="mb-6">
                    <CardHeader><CardTitle className="text-lg">Live Transcript</CardTitle></CardHeader>
                    <CardContent>
                      <div className="bg-gray-50 p-4 rounded-lg max-h-40 overflow-y-auto">
                        <p className="text-sm text-gray-700 leading-relaxed">{transcript}</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            <div className="grid md:grid-cols-2 gap-6 my-6">
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
