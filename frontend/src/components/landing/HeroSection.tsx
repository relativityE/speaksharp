import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2 } from 'lucide-react';


export const HeroSection = () => {
  return (
    <section className="relative w-full pt-24 md:pt-32 pb-16 md:pb-24 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background z-0" />
      <div className="container relative z-10 px-4 md:px-6 max-w-7xl mx-auto">
        {/* Text, Buttons, Checkmarks - Left aligned */}
        <div className="flex flex-col space-y-6 max-w-2xl">
          <Badge className="w-fit text-white bg-secondary border-secondary px-4 py-1 text-sm uppercase tracking-wider">
            AI-Powered Speaking Coach
          </Badge>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight tracking-tight whitespace-nowrap">
            Private Practice. <span className="text-primary">Public Impact!</span>
          </h1>
          <p className="text-xl text-muted-foreground leading-relaxed">
            Transform your communication skills with real-time feedback, filler word detection, and AI-powered insights that help you speak with confidence and precision.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 pt-2">
            <Button variant="default" size="lg" className="text-base px-6" asChild>
              <Link to="/auth/signup" data-testid="start-free-session-button">Start Speaking</Link>
            </Button>
            <Button variant="outline" size="lg" className="text-base px-6" asChild>
              <Link to="/analytics">View Analytics</Link>
            </Button>
          </div>

          {/* Feature Indicators */}
          <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-accent" />
              <span>Free to start</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-accent" />
              <span>No installation required</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-accent" />
              <span>Instant feedback</span>
            </div>
          </div>
        </div>

        {/* Speaker Image - Below, full width */}
        <div className="mt-12 w-full relative">
          <img
            src="/assets/hero-speaker.jpg"
            alt="Confident Speaker"
            width="1280"
            height="720"
            fetchPriority="high"
            loading="eager"
            className="rounded-2xl shadow-2xl border border-white/10 w-full object-cover aspect-[16/9]"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.parentElement!.innerHTML += '<div class="rounded-2xl shadow-2xl border border-white/10 w-full aspect-[16/9] bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center"><span class="text-gray-500 font-medium">Speaker Image</span></div>';
            }}
          />
          {/* Floating clarity badge */}
          <div className="absolute bottom-4 right-4 bg-card/90 backdrop-blur-sm rounded-xl px-4 py-3 flex items-center gap-3 border border-border">
            <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div>
              <div className="text-lg font-bold text-foreground">85% Clarity</div>
              <div className="text-sm text-muted-foreground">Real-time analysis</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
