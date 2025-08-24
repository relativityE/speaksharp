import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { Toaster } from '@/components/ui/sonner';
import { Header } from './components/Header';
import { MainPage } from './pages/MainPage';
import { SessionPage } from './pages/SessionPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import AuthPage from './pages/AuthPage';
function App() {
  useAuth();

  return (
    <div>
      <Header />
      <main data-testid="app-main">
        <Toaster />
        <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/" element={<MainPage />} />
            <Route path="/session" element={<SessionPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
          </Routes>
      </main>
    </div>
  );
}

export default App;
