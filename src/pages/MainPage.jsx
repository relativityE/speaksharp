import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useBrowserSupport } from '../hooks/useBrowserSupport';
import { BrowserWarning } from '../components/BrowserWarning';
import { Button } from '@/components/ui/button';
import { Zap, Shield, LineChart } from 'lucide-react';

const FeatureCard = ({ icon, title, children }) => (
  <div className="flex flex-col p-6 text-left bg-card rounded-lg">
    <div className="flex items-center justify-center w-12 h-12 mb-4 rounded-full bg-primary/10 text-primary">
      {icon}
    </div>
    <h3 className="mb-2 text-xl font-bold text-foreground">{title}</h3>
    <p className="text-muted-foreground">{children}</p>
  </div>
);

export const MainPage = () => {
    const navigate = useNavigate();
    const { isSupported } = useBrowserSupport();

    const handleStartSession = () => {
        navigate('/session');
    };

    return (
        <div className="flex flex-col min-h-screen bg-background text-foreground">
            <main className="flex-grow">
                {/* Hero Section */}
                <section className="container mx-auto px-4 py-20 text-center">
                    <BrowserWarning isSupported={isSupported} />
                    <h1 className="text-5xl md:text-6xl font-bold mb-4">
                        Speak with Clarity. Build Confidence.
                    </h1>
                    <p className="max-w-2xl mx-auto mb-8 text-lg text-muted-foreground">
                        Get real-time feedback to eliminate filler words and become a more articulate speaker.
                    </p>
                    <Button size="lg" onClick={handleStartSession}>
                        Start My Free Session
                    </Button>
                    <p className="mt-4 text-sm text-muted-foreground">
                        No account required. Get started in seconds.
                    </p>
                </section>

                {/* Trust Signal */}
                <section className="text-center py-12">
                    <p className="text-sm tracking-widest uppercase text-muted-foreground">
                        Designed by professionals for professionals.
                    </p>
                </section>


                {/* Value Proposition Section */}
                <section className="container mx-auto px-4 py-20">
                    <div className="grid gap-8 md:grid-cols-3">
                        <FeatureCard icon={<Zap size={24} />} title="Real-time Feedback">
                            Get immediate analysis of your speech patterns and filler word usage.
                        </FeatureCard>
                        <FeatureCard icon={<Shield size={24} />} title="Privacy First">
                            All audio processing happens locally. Your voice data never leaves your device.
                        </FeatureCard>
                        <FeatureCard icon={<LineChart size={24} />} title="Track Your Progress">
                            See how you improve over time with detailed analytics and session history.
                        </FeatureCard>
                    </div>
                </section>
            </main>

            {/* Footer */}
            <footer className="py-6 text-center border-t border-card">
                <p className="text-sm text-muted-foreground">
                    &copy; {new Date().getFullYear()} SpeakSharp. All rights reserved.
                </p>
            </footer>
        </div>
    );
};
