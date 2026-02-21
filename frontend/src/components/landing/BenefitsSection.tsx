import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Mic } from 'lucide-react';



export const BenefitsSection = () => {
    return (
        <section className="w-full py-24 md:py-32 bg-white/5">
            <div className="container px-4 md:px-6 max-w-7xl mx-auto">
                <div className="grid lg:grid-cols-2 gap-16 items-center">
                    <div className="space-y-8">
                        <div className="space-y-6">
                            <h2 className="text-4xl md:text-5xl font-extrabold text-foreground leading-tight">
                                Transform Your <span className="text-gradient-cyan">Communication</span> Skills
                            </h2>
                            <p className="text-xl text-muted-foreground leading-relaxed">
                                Join thousands of professionals who have improved their speaking confidence and eliminated distracting speech patterns.
                            </p>
                        </div>

                        <div className="grid sm:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div className="flex items-center gap-3 group">
                                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                                        <CheckCircle2 className="size-5 text-primary flex-shrink-0" />
                                    </div>
                                    <span className="text-muted-foreground font-medium">Reduce filler words</span>
                                </div>
                                <div className="flex items-center gap-3 group">
                                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                                        <CheckCircle2 className="size-5 text-primary flex-shrink-0" />
                                    </div>
                                    <span className="text-muted-foreground font-medium">Track progress</span>
                                </div>
                                <div className="flex items-center gap-3 group">
                                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                                        <CheckCircle2 className="size-5 text-primary flex-shrink-0" />
                                    </div>
                                    <span className="text-muted-foreground font-medium">Professional skills</span>
                                </div>
                            </div>
                            <div className="space-y-4">
                                <div className="flex items-center gap-3 group">
                                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                                        <CheckCircle2 className="size-5 text-primary flex-shrink-0" />
                                    </div>
                                    <span className="text-muted-foreground font-medium">Improve confidence</span>
                                </div>
                                <div className="flex items-center gap-3 group">
                                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                                        <CheckCircle2 className="size-5 text-primary flex-shrink-0" />
                                    </div>
                                    <span className="text-muted-foreground font-medium">AI-powered insights</span>
                                </div>
                                <div className="flex items-center gap-3 group">
                                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                                        <CheckCircle2 className="size-5 text-primary flex-shrink-0" />
                                    </div>
                                    <span className="text-muted-foreground font-medium">Real-time feedback</span>
                                </div>
                            </div>
                        </div>

                        <div className="pt-6">
                            <Button variant="default" size="lg" className="bg-secondary hover:bg-secondary/90 text-secondary-foreground glow-secondary h-12 px-8 text-base font-bold" asChild>
                                <Link to="/auth/signup" className="flex items-center gap-2">
                                    <Mic className="size-5" />
                                    Get Started Free
                                </Link>
                            </Button>
                        </div>
                    </div>

                    <div className="relative">
                        <div className="glass rounded-[2rem] p-8 relative z-10 overflow-hidden aspect-square flex items-center justify-center">
                            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-secondary/10 opacity-50" />
                            <div className="relative z-20 text-center space-y-4">
                                <div className="w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-6 glow-primary">
                                    <Mic className="w-12 h-12 text-primary" />
                                </div>
                                <div className="text-4xl font-bold text-foreground">SpeakSharp</div>
                                <p className="text-muted-foreground">Your personal AI speaking coach</p>
                            </div>
                        </div>
                        {/* Decorative background glow */}
                        <div className="absolute -top-10 -right-10 w-64 h-64 bg-primary/20 rounded-full blur-3xl opacity-50" />
                        <div className="absolute -bottom-10 -left-10 w-64 h-64 bg-secondary/10 rounded-full blur-3xl opacity-50" />
                    </div>
                </div>
            </div>
        </section>
    );
};
