import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CheckCircle2 } from 'lucide-react';

const benefits = [
    "Track filler words over time",
    "Track progress over time",
    "Practice talks, interviews, and presentations",
    "Build speaking confidence",
    "Post-session coaching insights",
    "Live cues while you speak",
];

export const BenefitsSection = () => {
    return (
        <section aria-label="Platform Benefits" className="w-full py-12 md:py-14">
            <div className="container px-4 md:px-6 max-w-5xl mx-auto text-center">
                <div className="space-y-3 mb-6">
                    <h2 className="text-3xl sm:text-5xl font-bold text-foreground leading-tight tracking-tight">
                        Turn practice into{' '}
                        <span className="text-amber-700">
                            confident communication
                        </span>
                    </h2>
                    <p className="mx-auto max-w-2xl text-lg font-medium text-foreground/70">
                        Start fast in your browser, keep your audio on-device with Private, and get structured feedback that helps you notice filler words, pace, and patterns over time.
                    </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-7">
                    {benefits.map((benefit, i) => (
                        <div
                            key={i}
                            className="flex items-center gap-3 px-6 py-4 rounded-xl bg-white border border-border text-left surface-shadow"
                        >
                            <CheckCircle2 className="size-5 text-success flex-shrink-0" />
                            <span className="text-sm font-medium text-foreground/80">{benefit}</span>
                        </div>
                    ))}
                </div>

                <div>
                    <Button
                        size="lg"
                        className="px-8 h-12 text-base"
                        asChild
                    >
                        <Link to="/auth/signup">Start free practice</Link>
                    </Button>
                </div>
            </div>
        </section>
    );
};
