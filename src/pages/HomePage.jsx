import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { MainPage } from './MainPage';
import { SessionPage } from './SessionPage';
import { LandingHeader } from '@/components/landing/LandingHeader';

export const HomePage = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return null; // or a loading spinner
  }

  if (user) {
    return <SessionPage />;
  }

  return (
    <>
      <LandingHeader />
      <MainPage />
    </>
  );
};
