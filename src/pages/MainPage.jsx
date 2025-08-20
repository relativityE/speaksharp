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
        <div className="flex flex-col min-h-screen bg-background text-foreground overflow-x-hidden">
            <main className="flex-grow">
                {/* Hero Section */}
                <section className="container mx-auto px-4 py-24 sm:py-32 text-center relative">
                    <div className="absolute inset-0 -z-10 h-full w-full bg-background bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px]"></div>
                    <div className="absolute -top-1/2 left-1/2 -z-10 h-96 w-96 -translate-x-1/2 rounded-full bg-[radial-gradient(circle_farthest-side,hsl(var(--primary)_/_0.15),transparent)] blur-3xl"></div>

                    <h1 className="text-5xl md:text-7xl font-bold mb-6 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
                        Speak with <span className="text-primary">Confidence</span>.
                    </h1>
                    <p className="max-w-3xl mx-auto mb-10 text-lg text-muted-foreground animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
                        Get real-time feedback to eliminate filler words and become a more articulate speaker. Privacy-first, no audio is ever stored on our servers.
                    </p>
                    <div className="flex flex-col items-center gap-4 animate-fade-in-up" style={{ animationDelay: '0.6s' }}>
                        <Button size="lg" className="text-lg font-bold py-8 px-10 shadow-[0_0_20px_hsl(var(--primary)_/_0.5)] transition-shadow hover:shadow-[0_0_30px_hsl(var(--primary)_/_0.7)]" onClick={handleStartSession}>
                            Start Your Free Session
                        </Button>
                        <p className="mt-2 text-sm text-muted-foreground">
                            No account required. Get started in seconds.
                        </p>
                    </div>
                </section>

                {/* Demo Section */}
                <section className="container mx-auto px-4 py-16 text-center">
                    <h2 className="text-4xl font-bold mb-10">See It in Action</h2>
                    <div className="max-w-4xl mx-auto">
                        <div className="aspect-video bg-secondary rounded-xl flex items-center justify-center border border-border mb-8 shadow-lg">
                            <p className="text-muted-foreground text-lg">Animated Demo Coming Soon!</p>
                        </div>
                        <div className="text-left p-6 bg-secondary rounded-xl border border-border">
                           <p className="text-lg md:text-xl leading-relaxed">
                                "So, <span className="bg-primary/20 text-primary px-2 py-1 rounded-md font-semibold">like</span>, the main point is, <span className="bg-destructive/20 text-destructive-foreground px-2 py-1 rounded-md font-semibold">um</span>, to, <span className="bg-primary/20 text-primary px-2 py-1 rounded-md font-semibold">you know</span>, speak more clearly. It's <span className="bg-green-500/20 text-green-400 px-2 py-1 rounded-md font-semibold">actually</span> very achievable."
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
            <footer className="py-6 text-center border-t border-border/50">
                <p className="text-sm text-muted-foreground">
                    &copy; {new Date().getFullYear()} SpeakSharp. All rights reserved.
                </p>
            </footer>
        </div>
    );
};
