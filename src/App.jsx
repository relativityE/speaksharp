import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { MainPage } from './pages/MainPage';
import { SessionPage } from './pages/SessionPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import AuthPage from './pages/AuthPage';
import TestPage from './pages/TestPage';
import { Toaster } from './components/ui/sonner';
import { Sidebar } from './components/Sidebar';

function App() {
  useAuth();

  return (
    <div className="flex bg-background min-h-screen">
      <Sidebar />
      <div className="flex-grow ml-64"> {/* Adjust content for fixed sidebar */}
        <main data-testid="app-main" className="p-8">
            <Toaster />
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/" element={<MainPage />} />
              <Route path="/session" element={<SessionPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              {/* Placeholder route for settings page from sidebar */}
              <Route path="/settings" element={<div className="text-4xl font-bold">Settings Page</div>} />
              <Route path="/test-page" element={<TestPage />} />
            </Routes>
        </main>
      </div>
    </div>
  );
}

export default App;
