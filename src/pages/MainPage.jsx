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
                    <h1 className="text-5xl md:text-7xl font-bold mb-4 text-foreground">
                        Speak with confidence.
                    </h1>
                    <p className="max-w-3xl mx-auto mb-8 text-xl text-muted-foreground">
                        Get real-time feedback to eliminate filler words and become a more articulate speaker. Privacy-first, no audio is ever stored.
                    </p>
                    <div className="flex flex-col items-center gap-4">
                        <Button size="lg" className="text-xl py-8 px-10" onClick={handleStartSession}>
                            Start Your Free Session
                        </Button>
                        <p className="mt-1 text-base text-muted-foreground">
                            No account required. Get started in seconds.
                        </p>
                    </div>
                </section>

                {/* Demo Section */}
                <section className="container mx-auto px-4 py-16 text-center">
                    <h2 className="text-4xl font-bold mb-8 text-foreground">See it in Action</h2>
                    <div className="max-w-4xl mx-auto">
                        <div className="aspect-video bg-card rounded-lg flex items-center justify-center border border-border mb-8">
                            <p className="text-muted-foreground text-lg">Animated Demo Placeholder</p>
                        </div>
                        <div className="text-left p-6 bg-card rounded-lg border border-border">
                           <p className="text-lg md:text-xl leading-relaxed text-foreground/90">
                                "So, <span className="bg-yellow-500/20 text-yellow-300 px-1.5 py-0.5 rounded">like</span>, the main point is, <span className="bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded">um</span>, to, <span className="bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded">you know</span>, speak more clearly. It's <span className="bg-green-500/20 text-green-300 px-1.5 py-0.5 rounded">actually</span> very achievable."
                            </p>
                        </div>
                    </div>
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
