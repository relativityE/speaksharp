import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, TrendingDown, Target, Clock, Mic, Crown, ArrowRight } from "lucide-react";
import analyticsImage from "@/assets/analytics-visual.jpg";

const Analytics = () => {
  const weeklyStats = [
    { day: "Mon", sessions: 2, clarity: 85 },
    { day: "Tue", sessions: 1, clarity: 78 },
    { day: "Wed", sessions: 3, clarity: 91 },
    { day: "Thu", sessions: 2, clarity: 88 },
    { day: "Fri", sessions: 1, clarity: 82 },
    { day: "Sat", sessions: 0, clarity: 0 },
    { day: "Sun", sessions: 1, clarity: 89 },
  ];

  const improvements = [
    { metric: "Clarity Score", current: 87, previous: 82, trend: "up" },
    { metric: "Filler Words", current: 3, previous: 8, trend: "down" },
    { metric: "Speaking Rate", current: 145, previous: 165, trend: "down" },
    { metric: "Session Length", current: "12m", previous: "8m", trend: "up" },
  ];

  const topFillers = [
    { word: "um", count: 23, percentage: 35 },
    { word: "uh", count: 18, percentage: 27 },
    { word: "like", count: 15, percentage: 23 },
    { word: "you know", count: 10, percentage: 15 },
  ];

  return (
    <div className="min-h-screen bg-gradient-subtle pt-20 pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Speaking Analytics</h1>
            <p className="text-muted-foreground">Track your progress and identify areas for improvement</p>
          </div>
          <div className="flex items-center space-x-3 mt-4 lg:mt-0">
            <Badge variant="secondary" className="flex items-center space-x-1">
              <Crown className="h-3 w-3" />
              <span>Free Plan</span>
            </Badge>
            <Button variant="hero" size="sm">
              Upgrade to Pro
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>

        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {improvements.map((item, index) => (
            <Card key={index} className="shadow-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">{item.metric}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="text-2xl font-bold text-foreground">{item.current}</div>
                  <div className={`flex items-center space-x-1 ${
                    item.trend === "up" ? "text-accent" : "text-secondary"
                  }`}>
                    {item.trend === "up" ? (
                      <TrendingUp className="h-4 w-4" />
                    ) : (
                      <TrendingDown className="h-4 w-4" />
                    )}
                    <span className="text-sm font-medium">
                      {item.trend === "up" ? "↑" : "↓"} from {item.previous}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Weekly Progress */}
          <div className="lg:col-span-2 space-y-6">
            {/* Session Activity */}
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Mic className="h-5 w-5 text-primary" />
                  <span>This Week's Activity</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {weeklyStats.map((day, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-12 text-sm font-medium text-muted-foreground">{day.day}</div>
                        <div className="flex items-center space-x-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{day.sessions} sessions</span>
                        </div>
                      </div>
                      {day.clarity > 0 && (
                        <div className="flex items-center space-x-2">
                          <div className="w-20">
                            <Progress value={day.clarity} className="h-2" />
                          </div>
                          <span className="text-sm font-medium w-8">{day.clarity}%</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Visual Analytics */}
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle>Speech Pattern Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative rounded-lg overflow-hidden">
                  <img
                    src={analyticsImage}
                    alt="Speech analytics dashboard showing patterns and improvements"
                    className="w-full h-64 object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-primary/20 to-transparent" />
                </div>
                <div className="mt-4 p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    <strong>Pro Insight:</strong> Your speaking patterns show consistent improvement in clarity.
                    Consider focusing on reducing "um" usage for even better results.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Goals */}
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Target className="h-5 w-5 text-accent" />
                  <span>Current Goals</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium">Reduce filler words</span>
                    <span className="text-sm text-muted-foreground">75%</span>
                  </div>
                  <Progress value={75} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium">Improve clarity</span>
                    <span className="text-sm text-muted-foreground">87%</span>
                  </div>
                  <Progress value={87} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium">Daily practice</span>
                    <span className="text-sm text-muted-foreground">60%</span>
                  </div>
                  <Progress value={60} className="h-2" />
                </div>
              </CardContent>
            </Card>

            {/* Top Filler Words */}
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle>Most Common Fillers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {topFillers.map((filler, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 bg-secondary/20 rounded-full flex items-center justify-center text-xs font-medium">
                        {index + 1}
                      </div>
                      <span className="text-sm font-medium">"{filler.word}"</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium">{filler.count}</div>
                      <div className="text-xs text-muted-foreground">{filler.percentage}%</div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Upgrade Prompt */}
            <Card className="shadow-card bg-gradient-hero">
              <CardContent className="p-6 text-center text-white">
                <Crown className="h-8 w-8 mx-auto mb-3 opacity-90" />
                <h3 className="font-semibold mb-2">Unlock Advanced Analytics</h3>
                <p className="text-sm opacity-90 mb-4">
                  Get detailed insights, custom goals, and AI-powered recommendations
                </p>
                <Button variant="secondary" size="sm" className="w-full">
                  Upgrade Now
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Analytics;