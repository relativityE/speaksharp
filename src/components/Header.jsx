import React from 'react';
import { Link } from 'react-router-dom';

export const Header = () => {
  return (
    <header className="text-center mb-8">
      <h1 className="text-4xl font-bold text-gray-900 mb-2">
        <Link to="/">SayLess</Link>
      </h1>
      <p className="text-lg text-gray-600">Real-time filler word detection for better speaking</p>
    </header>
  );
};
