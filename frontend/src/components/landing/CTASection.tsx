import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import { trackConversionCtaClicked, trackConversionCtaViewed } from '@/services/conversionFunnel';
import { useEffect } from 'react';

export const CTASection = () => {
    useEffect(() => {
        trackConversionCtaViewed({ source: 'landing_cta' });
    }, []);

    return (
        <section aria-label="Call to Action" className="w-full py-16 md:py-24">
            <div className="container px-4 md:px-6 max-w-3xl mx-auto">
                <div className="bg-white border border-border rounded-lg p-10 md:p-14 text-center space-y-5 shadow-card">
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground leading-tight">
                        Ready to Speak with{' '}
                        <span className="text-amber-700">Confidence?</span>
                    </h2>
                    <p className="text-base text-muted-foreground max-w-xl mx-auto">
                        Start your journey to clearer communication today. No credit card required.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
                        <Button
                            size="lg"
                            className="px-8 h-12 text-base"
                            asChild
                        >
                            <Link
                                to="/auth/signup"
                                className="flex items-center gap-2"
                                onClick={() => trackConversionCtaClicked({ source: 'landing_cta' })}
                            >
                                Start Free Session
                                <ArrowRight className="size-4" />
                            </Link>
                        </Button>
                        <Button
                            size="lg"
                            variant="secondary"
                            className="px-8 h-12 text-base"
                            asChild
                        >
                            <Link to="/analytics">See feedback analytics</Link>
                        </Button>
                    </div>
                </div>
            </div>
        </section>
    );
};
