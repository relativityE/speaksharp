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
                <section className="container mx-auto px-4 py-24 text-center">
                    <h1 className="text-5xl md:text-6xl font-bold mb-4">
                        Speak with confidence.
                    </h1>
                    <p className="max-w-3xl mx-auto mb-8 text-lg text-muted-foreground">
                        Get real-time feedback to eliminate filler words and become a more articulate speaker. Privacy-first, no audio is ever stored on our servers.
                    </p>
                    <div className="flex flex-col items-center gap-4">
                        <Button size="lg" className="text-lg font-semibold py-8 px-10" onClick={handleStartSession}>
                            Start Your Free Session
                        </Button>
                        <p className="mt-2 text-sm text-muted-foreground">
                            No account required. Get started in seconds.
                        </p>
                    </div>
                </section>

                {/* Demo Section */}
                <section className="container mx-auto px-4 py-16 text-center bg-secondary rounded-xl">
                    <h2 className="text-3xl font-bold mb-8">See it in Action</h2>
                    <div className="max-w-4xl mx-auto">
                        <div className="aspect-video bg-background rounded-lg flex items-center justify-center border-2 border-dashed border-border mb-8">
                            <p className="text-muted-foreground text-base">Animated Demo Placeholder</p>
                        </div>
                        <div className="text-left p-6 bg-background rounded-lg border">
                           <p className="text-base md:text-lg leading-relaxed">
                                "So, <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-semibold">like</span>, the main point is, <span className="bg-red-100 text-red-800 px-1.5 py-0.5 rounded font-semibold">um</span>, to, <span className="bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded font-semibold">you know</span>, speak more clearly. It's <span className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded font-semibold">actually</span> very achievable."
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
            <footer className="py-6 text-center border-t border-border">
                <p className="text-sm text-muted-foreground">
                    &copy; {new Date().getFullYear()} SpeakSharp. All rights reserved.
                </p>
            </footer>
        </div>
    );
};
