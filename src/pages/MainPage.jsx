import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useBrowserSupport } from '../hooks/useBrowserSupport';
import { BrowserWarning } from '../components/BrowserWarning';
import { Button } from '@/components/ui/button';
import { Zap, Shield, LineChart, Lock } from 'lucide-react';

const FeatureCard = ({ icon, title, children }) => (
  <div className="flex flex-col items-center p-6 text-center bg-card-bg rounded-lg md:items-start md:text-left">
    <div className="flex items-center justify-center w-12 h-12 mb-4 rounded-full bg-accent-blue/10 text-accent-blue">
      {icon}
    </div>
    <h3 className="mb-2 text-xl font-bold text-light-text">{title}</h3>
    <p className="text-muted-text">{children}</p>
  </div>
);

export const MainPage = () => {
    const navigate = useNavigate();
    const support = useBrowserSupport();

    const handleStartSession = () => {
        navigate('/session');
    };

    return (
        <div className="flex flex-col items-center px-4 pt-20 pb-20 text-center bg-charcoal">
            <BrowserWarning support={support} />

            <div className="max-w-3xl mx-auto mb-20">
                <h1 className="mb-4 text-5xl font-bold md:text-6xl text-light-text">
                    Speak with Clarity. Build Your Confidence.
                </h1>
                <p className="max-w-2xl mx-auto mb-8 text-lg text-muted-text">
                    SpeakSharp analyzes your speech in real-time to help you eliminate filler words like 'um' and 'uh.' Become a more confident and articulate speaker today.
                </p>
                <Button
                  size="lg"
                  className="bg-accent-blue text-charcoal hover:bg-accent-blue/90"
                  onClick={handleStartSession}
                >
                    Start My Free Session
                </Button>
                <p className="mt-4 text-sm text-muted-text">
                    No account required. Get started in seconds.
                </p>
            </div>

            <div className="w-full max-w-5xl mx-auto mb-20">
                <p className="mb-4 text-sm tracking-widest uppercase text-muted-text">
                    Designed for professionals to improve their communication.
                </p>
                {/* In a real app, you would have a component for logos */}
                <div className="flex items-center justify-center gap-12 opacity-50 grayscale">
                    {/* Placeholder for logos */}
                </div>
            </div>

            <div className="grid w-full max-w-5xl gap-8 md:grid-cols-3">
                 <FeatureCard icon={<Zap size={24} />} title="Instant Feedback">
                    Get immediate, real-time analysis of your speech patterns and filler word usage.
                </FeatureCard>
                <FeatureCard icon={<Lock size={24} />} title="Privacy First">
                    All audio processing happens locally in your browser. Your voice data never leaves your device.
                </FeatureCard>
                <FeatureCard icon={<LineChart size={24} />} title="Track Your Progress">
                    See how you improve over time with detailed analytics and session history.
                </FeatureCard>
            </div>
        </div>
    );
};
