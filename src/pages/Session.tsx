import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Mic, MicOff, Square, Play, Pause, AlertTriangle } from "lucide-react";

const Session = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [sessionTime] = useState("00:00");
  const [fillerCount] = useState(3);
  const [wordsPerMinute] = useState(145);
  const [clarityScore] = useState(87);

  const recentFillers = ["um", "uh", "like"];

  const handleStartStop = () => {
    if (isRecording) {
      setIsRecording(false);
      setIsPaused(false);
    } else {
      setIsRecording(true);
      setIsPaused(false);
    }
  };

  const handlePause = () => {
    setIsPaused(!isPaused);
  };

  return (
    <div className="min-h-screen bg-gradient-subtle pt-20 pb-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Practice Session</h1>
          <p className="text-muted-foreground">Speak clearly and we'll analyze your speech patterns in real-time</p>
        </div>

        {/* Main Session Interface */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recording Controls */}
          <div className="lg:col-span-2">
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Live Recording</span>
                  <Badge variant={isRecording ? "error" : "secondary"}>
                    {isRecording ? (isPaused ? "PAUSED" : "LIVE") : "READY"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Recording Visualization */}
                <div className="bg-muted rounded-lg p-8 text-center">
                  <div className={`w-24 h-24 mx-auto mb-4 rounded-full flex items-center justify-center transition-all duration-300 ${
                    isRecording && !isPaused
                      ? "bg-gradient-secondary animate-pulse shadow-elegant"
                      : "bg-gradient-primary"
                  }`}>
                    {isRecording ? (
                      <Mic className="h-12 w-12 text-white" />
                    ) : (
                      <MicOff className="h-12 w-12 text-white" />
                    )}
                  </div>

                  <div className="text-2xl font-bold text-foreground mb-2">{sessionTime}</div>
                  <div className="text-muted-foreground">
                    {isRecording
                      ? (isPaused ? "Session paused" : "Recording in progress...")
                      : "Click start to begin recording"
                    }
                  </div>
                </div>

                {/* Controls */}
                <div className="flex justify-center space-x-4">
                  <Button
                    variant={isRecording ? "destructive" : "hero"}
                    size="lg"
                    onClick={handleStartStop}
                    className="w-32"
                  >
                    {isRecording ? (
                      <>
                        <Square className="h-5 w-5 mr-2" />
                        Stop
                      </>
                    ) : (
                      <>
                        <Play className="h-5 w-5 mr-2" />
                        Start
                      </>
                    )}
                  </Button>

                  {isRecording && (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={handlePause}
                      className="w-32"
                    >
                      {isPaused ? (
                        <>
                          <Play className="h-5 w-5 mr-2" />
                          Resume
                        </>
                      ) : (
                        <>
                          <Pause className="h-5 w-5 mr-2" />
                          Pause
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Real-time Metrics */}
          <div className="space-y-6">
            {/* Clarity Score */}
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-lg">Clarity Score</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center">
                  <div className="text-3xl font-bold text-accent mb-2">{clarityScore}%</div>
                  <Progress value={clarityScore} className="mb-2" />
                  <p className="text-sm text-muted-foreground">Excellent clarity!</p>
                </div>
              </CardContent>
            </Card>

            {/* Speaking Rate */}
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-lg">Speaking Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary mb-1">{wordsPerMinute}</div>
                  <p className="text-sm text-muted-foreground">words per minute</p>
                  <div className="mt-2">
                    <Badge variant="secondary">Optimal Range</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Filler Words */}
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center">
                  <AlertTriangle className="h-5 w-5 mr-2 text-secondary" />
                  Filler Words
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center mb-3">
                  <div className="text-2xl font-bold text-secondary">{fillerCount}</div>
                  <p className="text-sm text-muted-foreground">detected this session</p>
                </div>

                {recentFillers.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">Recent:</p>
                    <div className="flex flex-wrap gap-1">
                      {recentFillers.map((filler, index) => (
                        <Badge key={index} variant="outline" className="text-xs">
                          "{filler}"
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Tips Section */}
        <Card className="mt-8 shadow-card">
          <CardHeader>
            <CardTitle>💡 Speaking Tips</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center p-4 bg-muted rounded-lg">
                <h4 className="font-semibold mb-2">Pace Yourself</h4>
                <p className="text-sm text-muted-foreground">Maintain 120-160 words per minute for optimal clarity</p>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <h4 className="font-semibold mb-2">Pause Instead</h4>
                <p className="text-sm text-muted-foreground">Use intentional pauses instead of filler words</p>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <h4 className="font-semibold mb-2">Practice Daily</h4>
                <p className="text-sm text-muted-foreground">Regular practice builds confident speaking habits</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Session;