import { Navigate } from 'react-router-dom';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { HeroSection } from "@/components/landing/HeroSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
// import { TestimonialsSection } from "@/components/landing/TestimonialsSection";
import { LandingFooter } from "@/components/landing/LandingFooter";

const Index = () => {
  const { session, loading } = useAuthProvider();

  if (loading) {
    return null; // Or a loading spinner if desired, but null avoids flash
  }

  if (session) {
    return <Navigate to="/session" replace />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* LandingHeader removed to avoid overlap with App Navigation */}
      <main className="flex-1">
        <HeroSection />
        <FeaturesSection />
        {/* <TestimonialsSection /> */}
      </main>
      <LandingFooter />
    </div>
  );
};

export default Index;