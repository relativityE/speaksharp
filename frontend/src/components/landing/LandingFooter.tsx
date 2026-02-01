import * as React from 'react';
import { Link } from 'react-router-dom';

export const LandingFooter = () => {
  return (
    <footer className="flex flex-col gap-2 sm:flex-row py-6 w-full shrink-0 items-center px-4 md:px-6 border-t bg-secondary-fg text-muted-foreground">
      <p className="text-xs">
        © {new Date().getFullYear()} SpeakSharp. All rights reserved.
      </p>
      <nav className="sm:ml-auto flex gap-4 sm:gap-6">
        <Link
          to="#"
          className="text-xs hover:underline underline-offset-4"
        >
          Terms of Service
        </Link>
        <Link
          to="#"
          className="text-xs hover:underline underline-offset-4"
        >
          Privacy
        </Link>
      </nav>
    </footer>
  );
};
