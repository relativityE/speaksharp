import React from 'react';
import { Button } from './ui/button';

export const Hero = ({ onStartTrial }) => {
  return (
    <div className="text-center">
      <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
        Improve your speaking, one less "um" at a time.
      </h1>
      <p className="mt-6 text-lg leading-8 text-muted-foreground">
        Start your session below. No account required. All processing is done locally in your browser.
      </p>
      <div className="mt-10 flex items-center justify-center gap-x-6">
        <Button onClick={onStartTrial} size="lg">Start Recording</Button>
      </div>
    </div>
  );
};
