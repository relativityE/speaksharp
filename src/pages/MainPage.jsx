import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useBrowserSupport } from '../hooks/useBrowserSupport';
import { BrowserWarning } from '../components/BrowserWarning';
import { Button } from '@/components/ui/button';

export const MainPage = () => {
    const navigate = useNavigate();
    const { isSupported, error } = useBrowserSupport();

    const handleStartSession = () => {
        navigate('/session');
    };

    return (
        <div className="flex flex-col min-h-screen bg-background text-foreground">
            <main className="flex-grow">
                {/* Hero Section */}
                <section className="container mx-auto px-4 py-20 text-center">
                    <h1 className="text-5xl md:text-6xl font-bold mb-4">
                        Speak with confidence.
                    </h1>
                    <p className="max-w-2xl mx-auto mb-8 text-xl text-muted-foreground">
                        Get real-time feedback to eliminate filler words and become a more articulate speaker.
                    </p>
                    <Button size="lg" onClick={handleStartSession}>
                        Try Free Session
                    </Button>
                    <p className="mt-4 text-base text-muted-foreground">
                        No account required. Get started in seconds.
                    </p>
                </section>

                {/* Browser Warning Section */}
                <section className="container mx-auto px-4 py-10">
                    <BrowserWarning isSupported={isSupported} supportError={error} />
                </section>
            </main>

            {/* Footer */}
            <footer className="py-6 text-center border-t border-card">
                <p className="text-base text-muted-foreground">
                    &copy; {new Date().getFullYear()} SpeakSharp. All rights reserved.
                </p>
            </footer>
        </div>
    );
};
