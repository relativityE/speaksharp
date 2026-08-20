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
        <section aria-label="Call to Action" className="w-full py-10 md:py-12">
            <div className="container px-4 md:px-6 max-w-3xl mx-auto">
                <div className="bg-white border border-border rounded-lg p-8 md:p-10 text-center space-y-4 surface-shadow">
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground leading-tight">
                        Ready to practice before it{' '}
                        <span className="text-amber-700">matters?</span>
                    </h2>
                    <p className="mx-auto max-w-xl text-base font-medium text-foreground/70">
                        Start the complete product free for 30 days. Your recordings stay Private on this device.
                    </p>
                    <div className="flex justify-center pt-4">
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
                                Start your 30-day trial
                                <ArrowRight className="size-4" />
                            </Link>
                        </Button>
                    </div>
                </div>
            </div>
        </section>
    );
};
