import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import { Header } from './components/Header';
import { MainPage } from './pages/MainPage';
import { SessionPage } from './pages/SessionPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import AuthPage from './pages/AuthPage';


function App() {
  const { user } = useAuth();

  return (
    <div>
      <Header />
      <main>
        <ErrorBoundary>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/" element={<MainPage />} />
            <Route path="/session" element={<SessionPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default App;
