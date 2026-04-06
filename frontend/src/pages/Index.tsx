import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { HeroSection } from "@/components/landing/HeroSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { BenefitsSection } from "@/components/landing/BenefitsSection";
// import { TestimonialsSection } from "@/components/landing/TestimonialsSection";
import { CTASection } from "@/components/landing/CTASection";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { LANDING_PAGE_REDIRECT_MS } from '@/config/env';
import { ENV } from '@/config/TestFlags';

const Index = () => {
  const { session, loading } = useAuthProvider();
  const isE2EMockMode = ENV.isE2E;

  // 🧪 Sync redirect for tests to prevent first-render flicker
  // In unit tests, we only redirect if we have a session.
  // In E2E tests, we skip if we have a session OR if in mock mode.
  const initialRedirect = (ENV.isE2E && isE2EMockMode && !ENV.isUnit) || !!session;
  const [shouldRedirect, setShouldRedirect] = useState(initialRedirect);

  // Delayed redirect for authenticated users - show landing page first
  useEffect(() => {
    // Already handled by sync initial state for tests
    if (ENV.isTest || isE2EMockMode) return;

    if (!loading && session) {
      const timer = setTimeout(() => {
        setShouldRedirect(true);
      }, LANDING_PAGE_REDIRECT_MS);

      return () => clearTimeout(timer);
    }
  }, [session, loading, isE2EMockMode]);

  // Redirect after delay
  if (shouldRedirect) {
    return <Navigate to="/session" replace />;
  }

  return (
    <div className="min-h-screen bg-background bg-gradient-radial flex flex-col">
      {/* LandingHeader removed to avoid overlap with App Navigation */}
      <main className="flex-1">
        <HeroSection />
        <FeaturesSection />
        <BenefitsSection />
        {/* <TestimonialsSection /> */}
        <CTASection />
      </main>
      <LandingFooter />
    </div>
  );
};

export default Index;