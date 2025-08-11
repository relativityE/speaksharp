import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useBrowserSupport } from '../hooks/useBrowserSupport';
import { BrowserWarning } from '../components/BrowserWarning';
import { Button } from '@/components/ui/button';

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
                    <h1 className="text-5xl md:text-6xl font-bold mb-4">
                        Reduce your filler words by 50% in 30 days.
                    </h1>
                    <p className="max-w-2xl mx-auto mb-8 text-lg text-muted-foreground">
                        Get real-time feedback to eliminate filler words and become a more articulate speaker.
                    </p>
                    <Button size="lg" onClick={handleStartSession}>
                        Try Free Session
                    </Button>
                    <p className="mt-4 text-sm text-muted-foreground">
                        No account required. Get started in seconds.
                    </p>
                </section>

                {/* Social Proof Section */}
                <section className="container mx-auto px-4 py-20 text-center">
                    <h2 className="text-3xl font-bold mb-4">Join over 1,000 professionals</h2>
                    <p className="text-muted-foreground mb-8">
                        Already 10,000+ sessions completed on our platform.
                    </p>
                    {/* Placeholder for testimonials */}
                    <div className="grid gap-8 md:grid-cols-3 text-left">
                        <div className="p-6 border border-card rounded-lg">
                            <p className="text-foreground mb-4">"SpeakSharp transformed my presentation skills. The real-time feedback is a game-changer."</p>
                            <div className="flex items-center">
                                <div className="w-12 h-12 rounded-full bg-muted mr-4"></div>
                                <div>
                                    <p className="font-bold text-foreground">Sarah J.</p>
                                    <p className="text-sm text-muted-foreground">Project Manager</p>
                                </div>
                            </div>
                        </div>
                        <div className="p-6 border border-card rounded-lg">
                            <p className="text-foreground mb-4">"I used to be so nervous about filler words. Now I speak with confidence. Highly recommend!"</p>
                            <div className="flex items-center">
                                <div className="w-12 h-12 rounded-full bg-muted mr-4"></div>
                                <div>
                                    <p className="font-bold text-foreground">Michael B.</p>
                                    <p className="text-sm text-muted-foreground">Sales Executive</p>
                                </div>
                            </div>
                        </div>
                        <div className="p-6 border border-card rounded-lg">
                            <p className="text-foreground mb-4">"The best tool for public speaking practice. It's simple, effective, and private."</p>
                            <div className="flex items-center">
                                <div className="w-12 h-12 rounded-full bg-muted mr-4"></div>
                                <div>
                                    <p className="font-bold text-foreground">Emily R.</p>
                                    <p className="text-sm text-muted-foreground">PhD Candidate</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Browser Warning Section */}
                <section className="container mx-auto px-4 py-10">
                    <BrowserWarning isSupported={isSupported} />
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
