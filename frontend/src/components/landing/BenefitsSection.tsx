import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CheckCircle2 } from 'lucide-react';

const benefits = [
    "Reduce filler words by up to 80%",
    "Track progress over time",
    "Professional presentation skills",
    "Improve speaking confidence",
    "AI-powered insights",
    "Real-time feedback",
];

const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            duration: 0.4,
            ease: [0.22, 1, 0.36, 1] as [number, number, number, number]
        }
    }
};

export const BenefitsSection = () => {
    return (
        <section aria-label="Platform Benefits" className="w-full py-24 md:py-32">
            <div className="container px-4 md:px-6 max-w-5xl mx-auto text-center">
                {/* Heading */}
                <motion.div
                    className="space-y-4 mb-12"
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6 }}
                >
                    <h2 className="text-3xl sm:text-5xl font-bold text-foreground leading-tight tracking-tight">
                        Transform Your{' '}
                        <span className="text-gradient-brand">
                            Communication
                        </span>
                    </h2>
                    <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                        Join thousands of professionals who have improved their speaking confidence.
                    </p>
                </motion.div>

                {/* Benefits 3x2 Grid */}
                <motion.div
                    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10"
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    variants={{
                        visible: {
                            transition: { staggerChildren: 0.08 }
                        }
                    }}
                >
                    {benefits.map((benefit, i) => (
                        <motion.div
                            key={i}
                            variants={itemVariants}
                            className="flex items-center gap-3 px-6 py-4 rounded-xl bg-card/60 border border-white/5 text-left"
                        >
                            <CheckCircle2 className="size-5 text-success flex-shrink-0" />
                            <span className="text-sm font-medium text-foreground/80">{benefit}</span>
                        </motion.div>
                    ))}
                </motion.div>

                {/* CTA */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.4, duration: 0.4 }}
                >
                    <Button
                        size="lg"
                        className="bg-secondary text-secondary-foreground font-bold px-8 h-12 rounded-full hover:bg-secondary/90 transition-all text-base"
                        asChild
                    >
                        <Link to="/auth/signup">Get Started Free</Link>
                    </Button>
                </motion.div>
            </div>
        </section>
    );
};
