import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Mic } from 'lucide-react';



export const BenefitsSection = () => {
    return (
        <section className="w-full py-16 md:py-24 lg:py-32">
            <div className="container px-4 md:px-6 max-w-6xl mx-auto">
                <div className="space-y-8">
                    <div className="space-y-4">
                        <h2 className="text-3xl sm:text-4xl font-bold text-foreground leading-tight">
                            Transform Your Communication Skills
                        </h2>
                        <p className="text-xl text-muted-foreground max-w-3xl">
                            Join thousands of professionals who have improved their speaking confidence and eliminated distracting speech patterns.
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-8 sm:gap-24">
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <CheckCircle2 className="size-5 text-accent flex-shrink-0" />
                                <span className="text-muted-foreground">Reduce filler words by up to 80%</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <CheckCircle2 className="size-5 text-accent flex-shrink-0" />
                                <span className="text-muted-foreground">Track progress over time</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <CheckCircle2 className="size-5 text-accent flex-shrink-0" />
                                <span className="text-muted-foreground">Professional presentation skills</span>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <CheckCircle2 className="size-5 text-accent flex-shrink-0" />
                                <span className="text-muted-foreground">Improve speaking confidence</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <CheckCircle2 className="size-5 text-accent flex-shrink-0" />
                                <span className="text-muted-foreground">AI-powered insights</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <CheckCircle2 className="size-5 text-accent flex-shrink-0" />
                                <span className="text-muted-foreground">Real-time feedback</span>
                            </div>
                        </div>
                    </div>

                    <div className="pt-4">
                        <Button variant="default" size="lg" className="text-base gap-2" asChild>
                            <Link to="/auth/signup">
                                <Mic className="size-4" />
                                Get Started Free
                            </Link>
                        </Button>
                    </div>
                </div>
            </div>
        </section>
    );
};
