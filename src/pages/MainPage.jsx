import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useBrowserSupport } from '../hooks/useBrowserSupport';
import { BrowserWarning } from '../components/BrowserWarning';
import { Button } from '@/components/ui/button';
import { APP_TAGLINE } from '../config';

export const MainPage = () => {
    const navigate = useNavigate();
    const { isSupported, error: supportError } = useBrowserSupport();

    const handleStartSession = () => {
        navigate('/session');
    };

    return (
        <div className="flex flex-col min-h-screen bg-background text-foreground">
            <main className="flex-grow">
                {/* Hero Section */}
                <section className="container mx-auto px-component-px py-24 text-center">
                    <h1 className="text-3xl md:text-5xl font-bold mb-4 text-glow">
                        {APP_TAGLINE}
                    </h1>
                    <p className="max-w-3xl mx-auto mb-8 text-lg text-muted-foreground">
                        Get real-time feedback to eliminate filler words and become a more articulate speaker. Privacy-first, no audio is ever stored on our servers.
                    </p>
                    <div className="flex flex-col items-center gap-component-gap">
                        <Button size="lg" className="text-lg font-semibold py-component-py px-10" onClick={handleStartSession}>
                            Start Your Free Session Now
                        </Button>
                        <p className="mt-2 text-sm text-muted-foreground/80">
                            100% free. No account required.
                        </p>
                    </div>
                </section>

                {/* Demo Section */}
                <section className="container mx-auto px-component-px py-16 text-center bg-secondary rounded-xl">
                    <h2 className="text-3xl font-bold mb-8">See it in Action</h2>
                    <div className="max-w-4xl mx-auto">
                        <div className="aspect-video bg-background rounded-lg flex items-center justify-center border-2 border-dashed border-border mb-8">
                            <p className="text-muted-foreground text-base">Animated Demo Placeholder</p>
                        </div>
                        <div className="text-left p-component-py bg-background rounded-lg border">
                           <p className="text-base md:text-lg leading-relaxed">
                                "So, <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-semibold">like</span>, the main point is, <span className="bg-red-100 text-red-800 px-1.5 py-0.5 rounded font-semibold">um</span>, to, <span className="bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded font-semibold">you know</span>, speak more clearly. It's <span className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded font-semibold">actually</span> very achievable."
                            </p>
                        </div>
                    </div>
                </section>

                {/* Browser Warning Section */}
                <section className="container mx-auto px-component-px py-10">
                    <BrowserWarning isSupported={isSupported} supportError={supportError} />
                </section>
            </main>

            {/* Footer */}
            <footer className="py-component-py text-center border-t border-border">
                <p className="text-sm text-muted-foreground">
                    &copy; {new Date().getFullYear()} SpeakSharp. All rights reserved.
                </p>
            </footer>
        </div>
    );
};
