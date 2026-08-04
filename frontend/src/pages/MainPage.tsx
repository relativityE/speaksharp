import * as React from "react";
import { useBrowserSupport } from "@/hooks/useBrowserSupport";
import { BrowserWarning } from "@/components/BrowserWarning";
import { HeroSection } from "@/components/landing/HeroSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { LandingFooter } from "@/components/landing/LandingFooter";

export function MainPage() {
  const { isSupported, error } = useBrowserSupport();

  if (!isSupported) {
    return <BrowserWarning isSupported={isSupported} supportError={error} />;
  }

  return (
    <div className="flex flex-col min-h-screen bg-secondary">
      <main className="flex-1 pt-16">
        <HeroSection />
        <FeaturesSection />
      </main>
      <LandingFooter />
    </div>
  );
}
