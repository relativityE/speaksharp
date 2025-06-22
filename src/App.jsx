import { useState } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Mic, MicOff, Play, Square, BarChart3, Settings } from 'lucide-react'
import './App.css'

function App() {
  const [isRecording, setIsRecording] = useState(false)
  const [sessionActive, setSessionActive] = useState(false)
  const [fillerCounts, setFillerCounts] = useState({
    um: 0,
    uh: 0,
    like: 0,
    youKnow: 0
  })

  const handleStartSession = () => {
    setSessionActive(true)
    setFillerCounts({ um: 0, uh: 0, like: 0, youKnow: 0 })
  }

  const handleEndSession = () => {
    setSessionActive(false)
    setIsRecording(false)
  }

  const handleToggleRecording = () => {
    setIsRecording(!isRecording)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">ClearSpeak AI</h1>
          <p className="text-lg text-gray-600">Real-time filler word detection for better speaking</p>
        </div>

        {/* Main Control Panel */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mic className="h-5 w-5" />
              Session Control
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
              <div className="text-center">
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${
                  isRecording ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'
                }`}>
                  <div className={`w-3 h-3 rounded-full ${
                    isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-400'
                  }`}></div>
                  {isRecording ? 'Recording...' : 'Ready to Record'}
                </div>
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
              </CardTitle>
              <CardDescription>
                Real-time tracking of common filler words
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
              <p className="text-gray-600">All processing happens on your device using WebAssembly. Your speech never leaves your device.</p>
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
          <p>ClearSpeak AI - Powered by on-device AI processing</p>
        </div>
      </div>
    </div>
  )
}

export default App
