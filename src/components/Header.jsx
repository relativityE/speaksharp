import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from './ui/button';

export const Header = () => {
  return (
    <header className="flex items-center justify-between p-4 border-b">
      <h1 className="text-2xl font-bold text-primary">
        <Link to="/">SayLess</Link>
      </h1>
      <nav>
        <Button asChild variant="ghost">
          <Link to="/analytics">View Analytics</Link>
        </Button>
      </nav>
    </header>
  );
};
