import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Mic } from 'lucide-react';

export const HomePage = () => {
  const navigate = useNavigate();

  const handleStartSession = () => {
    navigate('/session');
  };

  return (
    <div className="text-center mt-8">
      <p className="text-lg text-gray-600 mb-8">Click the button below to start a new session.</p>
      <Button onClick={handleStartSession} size="lg">
        <Mic className="h-4 w-4 mr-2" />
        Start New Session
      </Button>
    </div>
  );
};
