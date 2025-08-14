import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useBrowserSupport } from '../hooks/useBrowserSupport';
import { BrowserWarning } from '../components/BrowserWarning';
import { Button } from '@/components/ui/button';
import { Shield } from 'lucide-react';

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
                        Try a Free Session
                    </Button>
                    <p className="mt-4 text-lg text-foreground font-semibold">
                        No account required. Get started in seconds.
                    </p>
                    <div className="mt-8 flex items-center justify-center gap-2 text-muted-foreground">
                        <Shield size={18} />
                        <p className="text-base font-medium">Privacy-first: Your audio is never stored.</p>
                    </div>
                </section>

                {/* Demo Section */}
                <section className="container mx-auto px-4 py-16 text-center">
                    <h2 className="text-4xl font-bold mb-8">See it in Action</h2>
                    <div className="max-w-4xl mx-auto">
                        <div className="aspect-video bg-card rounded-lg flex items-center justify-center border-2 border-dashed border-border mb-8">
                            <p className="text-muted-foreground text-lg">Animated Demo Placeholder</p>
                        </div>
                        <div className="text-left p-6 bg-card rounded-lg shadow-sm border">
                           <p className="text-lg md:text-xl leading-relaxed">
                                "So, <span className="bg-yellow-300/30 px-1.5 py-0.5 rounded">like</span>, the main point is, <span className="bg-red-300/30 px-1.5 py-0.5 rounded">um</span>, to, <span className="bg-blue-300/30 px-1.5 py-0.5 rounded">you know</span>, speak more clearly. It's <span className="bg-green-300/30 px-1.5 py-0.5 rounded">actually</span> very achievable."
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
