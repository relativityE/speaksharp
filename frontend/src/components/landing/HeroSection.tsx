import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2 } from 'lucide-react';
import { HeroStatsDashboard } from './HeroStatsDashboard';


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

        {/* Animated Stats Dashboard - Replaces hero-speaker.jpg */}
        <div className="mt-12 w-full flex justify-center">
          <HeroStatsDashboard className="w-full max-w-2xl" />
        </div>
      </div>
    </section>
  );
};
