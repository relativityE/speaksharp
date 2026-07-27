import { BrowserWarning } from "@/components/BrowserWarning";
import { HeroSection } from "@/components/landing/HeroSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { BenefitsSection } from "@/components/landing/BenefitsSection";
// import { TestimonialsSection } from "@/components/landing/TestimonialsSection";
import { CTASection } from "@/components/landing/CTASection";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { useBrowserSupport } from "@/hooks/useBrowserSupport";

const Index = () => {
  const { isSupported, error } = useBrowserSupport();
  const showBrowserWarning = !isSupported && Boolean(error);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* LandingHeader removed to avoid overlap with App Navigation */}
      <main className="flex-1">
        {showBrowserWarning && (
          <div className="mx-auto max-w-7xl px-4 pb-2 pt-24 sm:px-6">
            <BrowserWarning isSupported={isSupported} supportError={error} />
          </div>
        )}
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
