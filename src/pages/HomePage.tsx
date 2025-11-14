import React from 'react';
import { useAuthProvider } from '../contexts/AuthProvider';
import { MainPage } from './MainPage';
import { SessionPage } from './SessionPage';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { Skeleton } from '@/components/ui/skeleton';

export const HomePage: React.FC = () => {
  const { user, loading } = useAuthProvider();

  if (loading) {
    return (
        <div className="flex flex-col min-h-screen">
            <header className="fixed w-full top-0 z-50 px-4 lg:px-6 h-16 flex items-center bg-card/70 backdrop-blur-sm">
                <Skeleton className="h-8 w-24" />
                <div className="ml-auto flex gap-4 sm:gap-6 items-center">
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-10 w-24" />
                </div>
            </header>
            <main className="flex-grow pt-16">
                <div className="container mx-auto px-4 py-10">
                    <Skeleton className="h-96 w-full" />
                </div>
            </main>
        </div>
    );
  }


  if (user && !import.meta.env.DEV) {
    return <SessionPage />;
  }

  return (
    <>
      <LandingHeader />
      <MainPage />
    </>
  );
};
