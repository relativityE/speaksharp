import * as React from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';


export const HeroSection = () => {
  return (
    <section className="relative w-full pt-32 md:pt-48 lg:pt-56 pb-20 md:pb-32 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-background z-0" />
      <div className="absolute inset-0 bg-[url('/assets/grid-pattern.svg')] opacity-10 z-0" />
      <div className="container relative z-10 px-4 md:px-6 max-w-6xl mx-auto">
        <div className="flex flex-col items-center text-center space-y-12">
          {/* Header Section - Centered */}
          <div className="flex flex-col items-center space-y-6 max-w-4xl">
            <Badge variant="outline" className="text-primary border-primary/50 bg-primary/10 px-4 py-1 text-sm uppercase tracking-wider">
              AI-Powered Speaking Coach
            </Badge>
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold text-foreground leading-tight tracking-tight">
              Private Practice. <span className="text-primary">Public Impact!</span>
            </h1>
            <p className="text-xl text-muted-foreground leading-relaxed max-w-[700px]">
              Transform your communication skills with real-time feedback, filler word detection, and AI-powered insights that help you speak with confidence and precision.
            </p>
          </div>

          {/* Speaker Image - Centered and Prominent */}
          <div className="relative w-full max-w-3xl">
            <div className="absolute -inset-4 bg-gradient-to-r from-primary to-purple-600 rounded-2xl blur-3xl opacity-20 animate-pulse" />
            <img
              src="/assets/hero-speaker.jpg"
              alt="Confident Speaker"
              className="relative rounded-2xl shadow-2xl border border-white/10 w-full object-cover aspect-[16/9] hover:scale-[1.02] transition-transform duration-500"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.parentElement!.innerHTML += '<div class="relative rounded-2xl shadow-2xl border border-white/10 w-full aspect-[16/9] bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center"><span class="text-gray-500 font-medium">Speaker Image</span></div>';
              }}
            />
          </div>

          {/* CTA Buttons - Centered Below Image */}
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <Button variant="default" size="lg" className="text-lg px-8 py-6 shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all" asChild>
              <Link to="/auth/signup" data-testid="start-free-session-button">Start Speaking</Link>
            </Button>
            <Button variant="outline" size="lg" className="text-lg px-8 py-6 bg-background/50 backdrop-blur-sm hover:bg-accent/10" asChild>
              <Link to="/analytics">View Analytics</Link>
            </Button>
          </div>

          {/* Feature Indicators */}
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span>Free to start</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span>No installation required</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span>Instant feedback</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
