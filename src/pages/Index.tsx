import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { Mic, BarChart3, Target, Zap, CheckCircle, Star } from "lucide-react";
import heroImage from "@/assets/hero-speaker.jpg";

const Index = () => {
  const features = [
    {
      icon: Mic,
      title: "Real-time Analysis",
      description: "Get instant feedback on your speech patterns, filler words, and clarity as you speak.",
      color: "text-primary"
    },
    {
      icon: BarChart3,
      title: "Progress Tracking",
      description: "Monitor your improvement over time with detailed analytics and personalized insights.",
      color: "text-accent"
    },
    {
      icon: Target,
      title: "Goal Setting",
      description: "Set specific speaking goals and track your progress towards better communication.",
      color: "text-secondary"
    }
  ];

  const benefits = [
    "Reduce filler words by up to 80%",
    "Improve speaking confidence",
    "Track progress over time",
    "AI-powered insights",
    "Professional presentation skills",
    "Real-time feedback"
  ];

  const testimonials = [
    {
      name: "TBD for now",
      role: "TBD for now",
      content: "TBD for now",
      rating: 5
    },
    {
      name: "TBD for now",
      role: "TBD for now",
      content: "TBD for now",
      rating: 5
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-subtle">
      {/* Hero Section */}
      <section className="pt-24 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <div className="space-y-4">
                <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-orange-500/30 w-fit">
                  <Zap className="h-4 w-4 mr-2" />
                  AI-Powered Speaking Coach
                </Badge>
                <div className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-tight">
                  <span className="font-medium">Speak with</span>
                  <br />
                  <span className="text-primary">Crystal</span> Clarity
                </div>
                <p className="text-xl text-muted-foreground leading-relaxed">
                  Transform your communication skills with real-time feedback, filler word detection,
                  and AI-powered insights that help you speak with confidence and precision.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <Button variant="hero" size="lg" asChild>
                  <Link to="/session" className="text-lg px-8 py-4 h-auto" data-testid="start-speaking-button">
                    <Mic className="h-5 w-5 mr-2" />
                    Start Speaking
                  </Link>
                </Button>
                <Button variant="outline" size="lg" asChild>
                  <Link to="/analytics" className="text-lg px-8 py-4 h-auto">
                    <BarChart3 className="h-5 w-5 mr-2" />
                    View Analytics
                  </Link>
                </Button>
              </div>

              <div className="flex items-center space-x-6 text-sm text-muted-foreground">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="h-4 w-4 text-accent" />
                  <span>Free to start</span>
                </div>
                <div className="flex items-center space-x-2">
                  <CheckCircle className="h-4 w-4 text-accent" />
                  <span>No installation required</span>
                </div>
                <div className="flex items-center space-x-2">
                  <CheckCircle className="h-4 w-4 text-accent" />
                  <span>Instant feedback</span>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="relative rounded-2xl overflow-hidden shadow-elegant">
                <img
                  src={heroImage}
                  alt="Professional speaker with clear communication visualization"
                  className="w-full h-96 object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-primary/20 to-transparent" />
              </div>
              <div className="absolute -bottom-6 -right-6 bg-card p-4 rounded-xl shadow-card border">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 bg-gradient-accent rounded-full flex items-center justify-center">
                    <Zap className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">85% Clarity</div>
                    <div className="text-sm text-muted-foreground">Real-time analysis</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Powerful Features for Better Speaking
            </h2>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
              Everything you need to develop clear, confident communication skills
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <Card key={index} className="shadow-card hover:shadow-elegant transition-all duration-300 hover:-translate-y-1">
                <CardHeader>
                  <div className={`w-12 h-12 rounded-lg bg-gradient-primary flex items-center justify-center mb-4`}>
                    <feature.icon className={`h-6 w-6 text-white`} />
                  </div>
                  <CardTitle className="text-xl">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-muted/30">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-6">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                Transform Your Communication Skills
              </h2>
              <p className="text-lg text-muted-foreground">
                Join thousands of professionals who have improved their speaking confidence
                and eliminated distracting speech patterns.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {benefits.map((benefit, index) => (
                  <div key={index} className="flex items-center space-x-3">
                    <CheckCircle className="h-5 w-5 text-accent flex-shrink-0" />
                    <span className="text-foreground">{benefit}</span>
                  </div>
                ))}
              </div>

              <Button variant="hero" size="lg" asChild>
                <Link to="/session">
                  Get Started Free
                  <Mic className="h-4 w-4 ml-2" />
                </Link>
              </Button>
            </div>

            <div className="space-y-6">
              {testimonials.map((testimonial, index) => (
                <Card key={index} className="shadow-card">
                  <CardContent className="p-6">
                    <div className="flex items-center space-x-1 mb-3">
                      {[...Array(testimonial.rating)].map((_, i) => (
                        <Star key={i} className="h-4 w-4 fill-secondary text-secondary" />
                      ))}
                    </div>
                    <p className="text-foreground mb-4">"{testimonial.content}"</p>
                    <div>
                      <div className="font-semibold text-foreground">{testimonial.name}</div>
                      <div className="text-sm text-muted-foreground">{testimonial.role}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <Card className="bg-gradient-hero shadow-elegant">
            <CardContent className="p-12 text-center text-white">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                Ready to Speak with Confidence?
              </h2>
              <p className="text-xl mb-8 opacity-90">
                Start your journey to clearer communication today. No credit card required.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button variant="secondary" size="lg" asChild>
                  <Link to="/session" className="text-lg px-8 py-4 h-auto">
                    Start Free Session
                    <Mic className="h-5 w-5 ml-2" />
                  </Link>
                </Button>
                <Button variant="outline" size="lg" className="bg-white/10 border-white/30 text-white hover:bg-white/20">
                  Learn More
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
};

export default Index;