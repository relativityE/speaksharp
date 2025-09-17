import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { SessionPage } from './pages/SessionPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import AuthPage from './pages/AuthPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { HomePage } from './pages/HomePage';

const App: React.FC = () => {
  return (
    <div>
      <main data-testid="app-main">
        <Toaster />
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/" element={<HomePage />} />
          <Route
            path="/session"
            element={
              <ProtectedRoute>
                <SessionPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/analytics"
            element={
              <ProtectedRoute>
                <AnalyticsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/analytics/:sessionId"
            element={
              <ProtectedRoute>
                <AnalyticsPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
    </div>
  );
}

export default App;
