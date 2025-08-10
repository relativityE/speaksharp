import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Header } from './components/Header';
import { SessionPage } from './pages/SessionPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { HomePage } from './pages/HomePage';

function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto">
        <Header />
        <main>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/session" element={<SessionPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default App;
