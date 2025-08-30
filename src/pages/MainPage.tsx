import * as React from "react";
import { useBrowserSupport } from "@/hooks/useBrowserSupport";
import { BrowserWarning } from "@/components/BrowserWarning";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { HeroSection } from "@/components/landing/HeroSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { TestimonialsSection } from "@/components/landing/TestimonialsSection";
import { LandingFooter } from "@/components/landing/LandingFooter";

export function MainPage() {
  const { isSupported, error } = useBrowserSupport();

  if (!isSupported) {
    return <BrowserWarning isSupported={isSupported} supportError={error} />;
  }

  return (
    <div className="flex flex-col min-h-screen bg-secondary">
      <LandingHeader />
      <main className="flex-1">
        <HeroSection />
        <FeaturesSection />
        <TestimonialsSection />
      </main>
      <LandingFooter />
    </div>
  );
}
