import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2 } from 'lucide-react';
import { HeroStatsDashboard } from './HeroStatsDashboard';


export const HeroSection = () => {
  const fadeUp = {
    hidden: { opacity: 0, y: 30 },
    visible: (i: number) => ({
      opacity: 1, y: 0,
      transition: { delay: i * 0.1, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] },
    }),
  };

  return (
    <section className="relative w-full pt-24 md:pt-32 pb-16 md:pb-24 overflow-hidden">
      <div className="container relative z-10 px-4 md:px-6 max-w-7xl mx-auto">
        {/* Text, Buttons, Checkmarks - Left aligned */}
        <div className="flex flex-col space-y-8 max-w-3xl">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass text-primary text-sm font-medium w-fit"
          >
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            AI-Powered Speaking Coach
          </motion.div>

          <motion.h1
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={1}
            className="text-5xl lg:text-7xl font-extrabold text-foreground leading-tight tracking-tight"
          >
            Private Practice. <br />
            <span className="text-gradient-hero">Public Impact!</span>
          </motion.h1>

          <motion.p
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={2}
            className="text-xl text-muted-foreground leading-relaxed max-w-2xl"
          >
            Transform your communication skills with real-time feedback, filler word detection, and AI-powered insights that help you speak with confidence and precision.
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={3}
            className="flex flex-col sm:flex-row gap-4 pt-4"
          >
            <Button variant="default" size="lg" className="bg-secondary hover:bg-secondary/90 text-secondary-foreground glow-secondary h-12 px-8 text-base font-bold transition-all" asChild>
              <Link to="/auth/signup" data-testid="start-free-session-button">Start Speaking</Link>
            </Button>
            <Button variant="outline" size="lg" className="glass border-white/10 text-foreground hover:bg-white/10 h-12 px-8 text-base transition-all" asChild>
              <Link to="/analytics">View Analytics</Link>
            </Button>
          </motion.div>

          {/* Feature Indicators */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={4}
            className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-accent" />
              <span>Free to start</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-accent" />
              <span>No installation required</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-accent" />
              <span>Instant feedback</span>
            </div>
          </motion.div>
        </div>

        {/* Animated Stats Dashboard - Replaces hero-speaker.jpg */}
        <motion.div
          className="mt-12 w-full flex justify-center"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.6, duration: 0.8 }}
        >
          <HeroStatsDashboard className="w-full max-w-2xl" />
        </motion.div>
      </div>
    </section>
  );
};
