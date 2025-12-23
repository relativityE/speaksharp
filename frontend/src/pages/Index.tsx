import { Navigate } from 'react-router-dom';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { HeroSection } from "@/components/landing/HeroSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { BenefitsSection } from "@/components/landing/BenefitsSection";
// import { TestimonialsSection } from "@/components/landing/TestimonialsSection";
import { CTASection } from "@/components/landing/CTASection";
import { LandingFooter } from "@/components/landing/LandingFooter";

const Index = () => {
  const { session, loading } = useAuthProvider();

  // Only redirect if user is authenticated - landing page is PUBLIC
  // Don't block on loading - show landing page immediately
  if (!loading && session) {
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