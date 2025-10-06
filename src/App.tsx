import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import Index from './pages/Index';
import Session from './pages/Session';
import Analytics from './pages/Analytics';
import AuthPage from './pages/AuthPage'; // Import the AuthPage component
import Navigation from './components/Navigation';

const App: React.FC = () => {
  return (
    <div>
      <Toaster />
      <Navigation />
      <main data-testid="app-main-container">
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<AuthPage />} /> {/* Add the missing auth route */}
          <Route path="/session" element={<Session />} />
          <Route path="/analytics" element={<Analytics />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;