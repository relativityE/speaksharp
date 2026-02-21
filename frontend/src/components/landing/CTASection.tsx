import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Mic } from 'lucide-react';

export const CTASection = () => {
    return (
        <section className="w-full py-16 md:py-24">
            <div className="container px-4 md:px-6 max-w-5xl mx-auto">
                <div className="glass-strong p-8 md:p-16 rounded-[2rem] text-center space-y-8 relative overflow-hidden">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
                    <h2 className="text-3xl md:text-5xl font-extrabold text-foreground leading-tight">
                        Ready to Speak with <span className="text-gradient-cyan">Confidence?</span>
                    </h2>
                    <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                        Start your journey to clearer communication today. No credit card required.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-6 justify-center pt-4">
                        <Button variant="default" size="lg" className="bg-secondary hover:bg-secondary/90 text-secondary-foreground glow-secondary h-12 px-8 text-base font-bold" asChild>
                            <Link to="/auth/signup" className="flex items-center gap-2">
                                <Mic className="size-5" />
                                Start Free Session
                            </Link>
                        </Button>
                        <Button variant="outline" size="lg" className="glass border-white/10 text-foreground hover:bg-white/10 h-12 px-8 text-base" asChild>
                            <Link to="/analytics">
                                Learn More
                            </Link>
                        </Button>
                    </div>
                </div>
            </div>
        </section>
    );
};
