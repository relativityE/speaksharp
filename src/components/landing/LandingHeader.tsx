import * as React from 'react';
import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const LandingHeader = () => {
  return (
    <header className="fixed w-full top-0 z-50 px-4 lg:px-6 h-16 flex items-center bg-card/70 backdrop-blur-sm">
      <Link to="/" className="flex items-center justify-center">
        <Zap className="size-6 text-primary" />
        <span className="sr-only">SpeakSharp</span>
      </Link>
      <nav className="ml-auto flex gap-4 sm:gap-6 items-center">
        <Link
          to="/session"
          className="text-sm font-medium hover:underline underline-offset-4 text-foreground"
        >
          Practice
        </Link>
        <Button variant="primary" size="sm" asChild>
          <Link to="/session">Start a Session</Link>
        </Button>
      </nav>
    </header>
  );
};
