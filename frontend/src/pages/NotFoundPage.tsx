import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export const NotFoundPage = () => {
  return (
    <div className="min-h-[calc(100vh-var(--header-height))] bg-background px-4 pb-16 pt-28">
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-5">
        <p className="text-sm font-semibold uppercase text-muted-foreground">404</p>
        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Page not found</h1>
          <p className="max-w-xl text-base leading-7 text-muted-foreground">
            The page you requested is not available. Start a practice session or return home.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/session">Go to session</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/">Home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
};
