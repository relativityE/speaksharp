import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import Index from './pages/Index';
import Session from './pages/Session';
import Analytics from './pages/Analytics';
import Navigation from './components/Navigation';

const App: React.FC = () => {
  return (
    <div>
      <Toaster />
      <Navigation />
      <main data-testid="app-main">
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/session" element={<Session />} />
          <Route path="/analytics" element={<Analytics />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;