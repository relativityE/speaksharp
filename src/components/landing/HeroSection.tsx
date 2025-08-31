import * as React from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { APP_TAGLINE } from '@/config';

export const HeroSection = () => {
  return (
    <section className="w-full pt-24 md:pt-32 lg:pt-48 xl:pt-56 pb-12 md:pb-24 lg:pb-32 bg-gradient-to-br from-primary/10 via-background to-accent/10">
      <div className="container px-4 md:px-6">
        <div className="grid gap-6 items-center">
          <div className="flex flex-col justify-center space-y-4 text-center">
            <div className="space-y-3">
              <Badge variant="primary" size="md">Speak with Confidence</Badge>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight">
                {APP_TAGLINE}
              </h1>
              <p className="text-xl text-muted-foreground leading-relaxed max-w-[600px] mx-auto">
                Get real-time feedback to eliminate filler words and become a more articulate speaker. Privacy-first, no audio is ever stored on our servers.
              </p>
            </div>
            <div className="w-full max-w-sm sm:max-w-md mx-auto flex gap-4">
              <Button variant="primary" size="lg" className="flex-1" asChild>
                <Link to="/session">Start For Free</Link>
              </Button>
              <Button variant="outline" size="lg" className="flex-1">
                Learn More
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
