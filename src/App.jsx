import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { MainPage } from './pages/MainPage';
import { SessionPage } from './pages/SessionPage';
import { AnalyticsPage } from './pages/AnalyticsPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<MainPage />} />
      <Route path="/session" element={<SessionPage />} />
      <Route path="/analytics" element={<AnalyticsPage />} />
    </Routes>
  );
}

export default App;
