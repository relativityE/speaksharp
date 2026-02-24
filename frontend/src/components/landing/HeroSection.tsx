import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Sparkles, ArrowRight } from 'lucide-react';
import { HeroStatsDashboard } from './HeroStatsDashboard';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.2
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: [0.22, 1, 0.36, 1] as [number, number, number, number]
    }
  }
};

export const HeroSection = () => {
  return (
    <section className="relative w-full pt-24 md:pt-32 pb-16 md:pb-24 overflow-hidden">
      {/* Background gradient now handled by page wrapper in Index.tsx */}
      <div className="container relative z-10 px-4 md:px-6 max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          {/* Left Column: Text Content */}
          <motion.div
            className="flex flex-col space-y-6"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            <motion.div variants={itemVariants}>
              <Badge className="w-fit glass text-primary border-none px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2 rounded-full">
                <Sparkles className="size-3 fill-current" />
                AI-Powered Speaking Coach
              </Badge>
            </motion.div>

            <motion.h1
              variants={itemVariants}
              className="text-5xl sm:text-6xl lg:text-[72px] font-extrabold leading-[1.05] tracking-tight"
            >
              <span className="text-foreground">Private Practice.</span>
              <br />
              <span className="text-gradient-hero">Public Impact!</span>
            </motion.h1>

            <motion.p
              variants={itemVariants}
              className="text-lg text-muted-foreground leading-relaxed max-w-xl font-medium"
            >
              Transform your communication skills with real-time feedback, filler word detection, and AI-powered insights that help you speak with confidence.
            </motion.p>

            {/* Buttons + Trust badges share the same max-width so edges align */}
            <div className="max-w-md w-full pt-6 space-y-4">
              <motion.div variants={itemVariants} className="flex gap-4">
                <Button variant="secondary" size="lg" className="flex-1 bg-secondary text-secondary-foreground font-bold h-14 rounded-xl glow-secondary hover:bg-secondary/90 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 text-base" asChild>
                  <Link to="/auth/signup" data-testid="start-free-session-button" className="flex items-center justify-center gap-2">
                    Start Speaking
                    <ArrowRight className="size-5" />
                  </Link>
                </Button>
                <Button size="lg" className="flex-1 glass border-white/10 text-foreground font-bold h-14 rounded-xl hover:bg-white/10 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 text-base" asChild>
                  <Link to="/analytics">View Analytics</Link>
                </Button>
              </motion.div>

              <motion.div variants={itemVariants} className="flex items-center justify-between text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-accent" />
                  <span>Free to start</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-accent" />
                  <span>No installation</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-accent" />
                  <span>Instant feedback</span>
                </div>
              </motion.div>
            </div>
          </motion.div>

          {/* Right Column: Dashboard */}
          <motion.div
            className="w-full flex justify-center lg:justify-end"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.8, ease: "easeOut" }}
          >
            <HeroStatsDashboard className="w-full max-w-lg" />
          </motion.div>
        </div>
      </div>
    </section>
  );
};
