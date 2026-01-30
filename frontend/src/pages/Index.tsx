import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { HeroSection } from "@/components/landing/HeroSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { BenefitsSection } from "@/components/landing/BenefitsSection";
// import { TestimonialsSection } from "@/components/landing/TestimonialsSection";
import { CTASection } from "@/components/landing/CTASection";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { IS_TEST_ENVIRONMENT, LANDING_PAGE_REDIRECT_MS } from '@/config/env';

const Index = () => {
  const { session, loading } = useAuthProvider();
  const [shouldRedirect, setShouldRedirect] = useState(false);

  // Delayed redirect for authenticated users - show landing page first
  useEffect(() => {
    if (!loading && session) {
      // 🧪 In test environment, redirect immediately
      if (IS_TEST_ENVIRONMENT) {
        setShouldRedirect(true);
        return;
      }

      /**
       * ARCHITECTURE NOTE (Senior Architect):
       * This is an INTENTIONAL UX delay, NOT a wait-for-event pattern.
       * 
       * Purpose: Show marketing content to authenticated returning users
       * before auto-redirecting them to /session.
       * 
       * Why setTimeout is correct here:
       * 1. There's no event to wait for - it's a designed pause
       * 2. Value is configurable via LANDING_PAGE_REDIRECT_MS config
       * 3. Test environment bypasses entirely (IS_TEST_ENVIRONMENT)
       * 
       * This follows UX best practice for "welcome back" experiences.
       */
      const timer = setTimeout(() => {
        setShouldRedirect(true);
      }, LANDING_PAGE_REDIRECT_MS);

      return () => clearTimeout(timer);
    }
  }, [session, loading]);

  // Redirect after delay
  if (shouldRedirect) {
    return <Navigate to="/session" replace />;
  }

  return (
    <div className="min-h-screen bg-gradient-subtle flex flex-col">
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