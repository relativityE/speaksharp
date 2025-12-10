import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Mic } from 'lucide-react';

export const CTASection = () => {
    return (
        <section className="w-full py-16 md:py-24">
            <div className="container px-4 md:px-6 max-w-4xl mx-auto">
                <Card className="bg-primary p-8 md:p-12 rounded-2xl text-center space-y-6">
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white leading-tight">
                        Ready to Speak with Confidence?
                    </h2>
                    <p className="text-lg text-white/80 max-w-2xl mx-auto">
                        Start your journey to clearer communication today. No credit card required.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
                        <Button variant="secondary" size="lg" className="text-base gap-2" asChild>
                            <Link to="/auth/signup">
                                <Mic className="size-4" />
                                Start Free Session
                            </Link>
                        </Button>
                        <Button variant="outline" size="lg" className="text-base bg-transparent border-white/30 text-white hover:bg-white/10" asChild>
                            <Link to="/analytics">
                                Learn More
                            </Link>
                        </Button>
                    </div>
                </Card>
            </div>
        </section>
    );
};
