import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CheckCircle2 } from 'lucide-react';
import { HeroStatsDashboard } from './HeroStatsDashboard';


export const HeroSection = () => {
  return (
    <section className="relative w-full pt-32 md:pt-48 pb-16 md:pb-24 overflow-hidden">
      <div className="container relative z-10 px-4 md:px-6 max-w-7xl mx-auto">
        {/* Text, Buttons, Checkmarks - Left aligned */}
        <div className="flex flex-col space-y-8 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass text-primary text-sm font-medium w-fit">
            <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            AI-Powered Speaking Coach
          </div>

          <h1 className="text-5xl lg:text-7xl font-extrabold text-foreground leading-[1.1] tracking-tight">
            Private Practice. <br />
            <span className="text-gradient-hero">Public Impact!</span>
          </h1>

          <p className="text-xl text-muted-foreground leading-relaxed max-w-2xl">
            Transform your communication skills with real-time feedback, filler word detection, and AI-powered insights that help you speak with confidence and precision.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-6 pt-4">
            <Button size="lg" className="bg-secondary hover:bg-secondary/90 text-secondary-foreground glow-secondary h-14 px-10 text-lg font-bold rounded-full transition-all hover:scale-105 active:scale-95" asChild>
              <Link to="/auth/signup" data-testid="start-free-session-button">Start Speaking Free</Link>
            </Button>
            <Button variant="outline" size="lg" className="glass border-white/10 text-foreground hover:bg-white/10 h-14 px-10 text-lg font-semibold rounded-full" asChild>
              <Link to="/analytics">Review Analytics</Link>
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
