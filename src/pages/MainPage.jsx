import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle, Zap, Shield, Star } from "lucide-react";
import { Link } from "react-router-dom";
import { useBrowserSupport } from "@/hooks/useBrowserSupport";
import { BrowserWarning } from "@/components/BrowserWarning";
import { APP_TAGLINE } from '../config';

export function MainPage() {
  const { isSupported, error } = useBrowserSupport();

  if (!isSupported) {
    return <BrowserWarning error={error} />;
  }

  return (
    <div className="flex flex-col min-h-screen bg-solid-light">
      <header className="fixed w-full top-0 z-50 px-4 lg:px-6 h-16 flex items-center bg-glassmorphism">
        <Link to="/" className="flex items-center justify-center">
          <Zap className="size-6 text-primary-600" />
          <span className="sr-only">SpeakSharp</span>
        </Link>
        <nav className="ml-auto flex gap-4 sm:gap-6 items-center">
          <Link
            to="/session"
            className="text-sm font-medium hover:underline underline-offset-4"
          >
            Practice
          </Link>
          <Button variant="brand" size="sm" asChild>
            <Link to="/session">Start a Session</Link>
          </Button>
        </nav>
      </header>
      <main className="flex-1">
        <section className="w-full pt-24 md:pt-32 lg:pt-48 xl:pt-56 pb-12 md:pb-24 lg:pb-32 bg-gradient-speaksharp">
          <div className="container px-4 md:px-6">
            <div className="grid gap-6 items-center">
              <div className="flex flex-col justify-center space-y-4 text-center">
                <div className="space-y-3">
                    <div className="badge-primary inline-block">Speak with Confidence</div>
                  <h1 className="h1">
                    {APP_TAGLINE}
                  </h1>
                  <p className="body-lg max-w-[600px] mx-auto">
                    Get real-time feedback to eliminate filler words and become a more articulate speaker. Privacy-first, no audio is ever stored on our servers.
                  </p>
                </div>
                <div className="w-full max-w-sm sm:max-w-md mx-auto flex gap-4">
                  <Button variant="brand" size="lg" className="flex-1" asChild>
                    <Link to="/session">Start For Free</Link>
                  </Button>
                   <Button variant="outline" size="lg" className="flex-1">
                    Learn More
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="w-full py-12 md:py-24 lg:py-32 bg-solid-light">
          <div className="container px-4 md:px-6">
            <div className="flex flex-col items-center justify-center space-y-4 text-center">
              <div className="space-y-3">
                <div className="badge-primary">
                  Key Features
                </div>
                <h2 className="h2">
                  Everything you need to practice
                </h2>
                <p className="body-lg max-w-[900px]">
                  TBD
                </p>
              </div>
            </div>
            <div className="mx-auto grid max-w-5xl items-start gap-12 sm:grid-cols-2 md:grid-cols-3 lg:gap-16 mt-12">
                <Card className="card-feature">
                  <div className="icon-container-md bg-primary-100 text-primary-600 anim-icon-scale">
                    <Zap className="size-8" />
                  </div>
                  <h3 className="h4 mt-4">Real-time Transcription</h3>
                  <p className="body-sm mt-2">TBD</p>
                </Card>
                <Card className="card-feature">
                  <div className="icon-container-md bg-green-100 text-green-600 anim-icon-scale">
                    <CheckCircle className="size-8" />
                  </div>
                  <h3 className="h4 mt-4">Filler Word Detection</h3>
                  <p className="body-sm mt-2">TBD</p>
                </Card>
                <Card className="card-feature">
                  <div className="icon-container-md bg-purple-100 text-purple-600 anim-icon-scale">
                    <Shield className="size-8" />
                  </div>
                  <h3 className="h4 mt-4">Privacy Focused</h3>
                  <p className="body-sm mt-2">TBD</p>
                </Card>
            </div>
          </div>
        </section>
        <section className="w-full py-12 md:py-24 lg:py-32 bg-solid-white">
            <div className="container px-4 md:px-6">
                <div className="flex flex-col items-center justify-center space-y-4 text-center">
                    <div className="space-y-3">
                        <div className="badge-accent">
                            Testimonials
                        </div>
                        <h2 className="h2">
                            Trusted by Professionals
                        </h2>
                    </div>
                </div>
                <div className="mx-auto grid max-w-5xl items-start gap-12 sm:grid-cols-2 lg:gap-16 mt-12">
                    <Card className="card-testimonial">
                        <p className="body mt-4">"TBD"</p>
                        <div className="flex items-center gap-4 mt-4">
                            <img src="https://randomuser.me/api/portraits/men/32.jpg" alt="user" className="size-12 rounded-full" />
                            <div>
                                <h3 className="h4">TBD</h3>
                                <div className="flex mt-1">
                                    {[...Array(5)].map((_, i) => <Star key={i} className="size-4 fill-yellow-400 text-yellow-400" />)}
                                </div>
                            </div>
                        </div>
                    </Card>
                    <Card className="card-testimonial">
                        <p className="body mt-4">"TBD"</p>
                        <div className="flex items-center gap-4 mt-4">
                            <img src="https://randomuser.me/api/portraits/women/44.jpg" alt="user" className="size-12 rounded-full" />
                            <div>
                                <h3 className="h4">TBD</h3>
                                <div className="flex mt-1">
                                    {[...Array(5)].map((_, i) => <Star key={i} className="size-4 fill-yellow-400 text-yellow-400" />)}
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
        </section>
      </main>
      <footer className="flex flex-col gap-2 sm:flex-row py-6 w-full shrink-0 items-center px-4 md:px-6 border-t bg-gray-900 text-gray-400">
        <p className="text-xs">
          © {new Date().getFullYear()} SpeakSharp. All rights reserved.
        </p>
        <nav className="sm:ml-auto flex gap-4 sm:gap-6">
          <Link
            to="#"
            className="text-xs hover:underline underline-offset-4"
          >
            Terms of Service
          </Link>
          <Link
            to="#"
            className="text-xs hover:underline underline-offset-4"
          >
            Privacy
          </Link>
        </nav>
      </footer>
    </div>
  );
}
