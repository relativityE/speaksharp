import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Header } from './components/Header';
import { MainPage } from './pages/MainPage';
import { SessionPage } from './pages/SessionPage';
import { AnalyticsPage } from './pages/AnalyticsPage';

function App() {
  return (
    <div>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<MainPage />} />
          <Route path="/session" element={<SessionPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
