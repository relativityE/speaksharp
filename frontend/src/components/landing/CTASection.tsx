import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

export const CTASection = () => {
    return (
        <section className="w-full py-16 md:py-24">
            <div className="container px-4 md:px-6 max-w-3xl mx-auto">
                <div className="bg-white/[0.06] backdrop-blur-xl border border-white/10 rounded-2xl p-10 md:p-14 text-center space-y-5">
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white leading-tight">
                        Ready to Speak with{' '}
                        <span className="text-[#0EA5E9]">Confidence?</span>
                    </h2>
                    <p className="text-base text-slate-400 max-w-xl mx-auto">
                        Start your journey to clearer communication today. No credit card required.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
                        <Button
                            size="lg"
                            className="bg-[#EEBD2B] text-slate-950 font-bold px-8 h-12 rounded-full hover:bg-[#EEBD2B]/90 transition-all text-base"
                            asChild
                        >
                            <Link to="/auth/signup" className="flex items-center gap-2">
                                Start Free Session
                                <ArrowRight className="size-4" />
                            </Link>
                        </Button>
                        <Button
                            size="lg"
                            className="bg-white/5 border border-white/10 text-white font-semibold px-8 h-12 rounded-full hover:bg-white/10 transition-all text-base"
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
