import React, { useEffect } from 'react';
import { ArrowRightIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ConfigurationNeededPage: React.FC = () => {
  // Deterministically hide loading spinner once component mounts
  useEffect(() => {
    requestAnimationFrame(() => {
      document.body.classList.add('app-loaded');
    });
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background to-accent/10 p-4">
      <div className="max-w-md text-center">
        <div className="mb-6 text-6xl">🔧</div>
        <h1 className="mb-4 text-3xl font-bold text-foreground">
          Configuration Required
        </h1>
        <p className="mb-6 text-muted-foreground">
          It looks like you're missing some environment variables. Please check your <code className="rounded bg-muted px-2 py-1 font-mono text-sm">.env</code> file and ensure all required variables are set.
        </p>
        <div className="rounded-lg border bg-card p-4 text-left">
          <p className="mb-2 font-medium">Required environment variables:</p>
          <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
            <li>VITE_SUPABASE_URL</li>
            <li>VITE_SUPABASE_ANON_KEY</li>
            <li>VITE_STRIPE_PUBLISHABLE_KEY</li>
          </ul>
        </div>
        <Button
          className="mt-6"
          onClick={() => window.location.reload()}
          size="lg"
        >
          Reload Application
          <ArrowRightIcon className="ml-2 h-4 w-4" />
        </Button>
        <p className="mt-4 text-sm text-muted-foreground">
          See <code className="rounded bg-muted px-2 py-1 font-mono text-xs">.env.example</code> for a template.
        </p>
      </div>
    </div>
  );
};

export default ConfigurationNeededPage;
