import React from 'react';
import { Header } from '../components/Header';
import { Frown } from 'lucide-react';

export const ErrorPage = () => {
  return (
    <div className="flex flex-col min-h-screen bg-muted/40">
      <Header />
      <main className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
        <Frown className="w-16 h-16 text-muted-foreground" />
        <h1 className="text-4xl font-bold tracking-tighter">An Error Occurred</h1>
        <p className="text-muted-foreground max-w-md">
          Something went wrong on our end. Please try refreshing the page, or contact support if the problem persists.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          Refresh Page
        </button>
      </main>
    </div>
  );
};
