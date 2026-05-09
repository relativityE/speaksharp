import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

export const CTASection = () => {
    return (
        <section aria-label="Call to Action" className="w-full py-16 md:py-24">
            <div className="container px-4 md:px-6 max-w-3xl mx-auto">
                <div className="bg-card/80 backdrop-blur-xl border border-border/60 rounded-lg p-10 md:p-14 text-center space-y-5">
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground leading-tight">
                        Ready to Speak with{' '}
                        <span className="text-primary">Confidence?</span>
                    </h2>
                    <p className="text-base text-muted-foreground max-w-xl mx-auto">
                        Start your journey to clearer communication today. No credit card required.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
                        <Button
                            size="lg"
                            className="bg-primary text-primary-foreground font-bold px-8 h-12 rounded-md hover:bg-primary/90 transition-all text-base"
                            asChild
                        >
                            <Link to="/auth/signup" className="flex items-center gap-2">
                                Start Free Session
                                <ArrowRight className="size-4" />
                            </Link>
                        </Button>
                        <Button
                            size="lg"
                            className="bg-white/5 border border-border/70 text-foreground font-semibold px-8 h-12 rounded-md hover:bg-white/10 transition-all text-base"
                            asChild
                        >
                            <Link to="/analytics">Learn More</Link>
                        </Button>
                    </div>
                </div>
            </div>
        </section>
    );
};
