import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { Header } from './components/Header';
import { MainPage } from './pages/MainPage';
import { SessionPage } from './pages/SessionPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import AuthPage from './pages/AuthPage';
import TestPage from './pages/TestPage';


function App() {
  useAuth();

  return (
    <div>
      <Header />
      <main>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/" element={<MainPage />} />
            <Route path="/session" element={<SessionPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/test-page" element={<TestPage />} />
          </Routes>
      </main>
    </div>
  );
}

export default App;
