import React from 'react';
import { Link } from 'react-router-dom';

export const Header = () => {
  return (
    <header className="flex items-center justify-between p-4 border-b">
      <h1 className="text-2xl font-bold text-gray-900">
        <Link to="/">SayLess</Link>
      </h1>
    </header>
  );
};
