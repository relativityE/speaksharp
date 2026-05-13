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
    <section aria-label="Hero" className="relative w-full pt-24 md:pt-32 pb-16 md:pb-24 overflow-hidden">
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
              <Badge className="w-fit bg-amber-100 text-amber-900 border border-amber-200 px-4 py-1.5 text-[11px] font-semibold flex items-center gap-2 rounded-full shadow-none">
                <Sparkles className="size-3 fill-current" />
                AI-Powered Speaking Coach
              </Badge>
            </motion.div>

            <motion.h1
              variants={itemVariants}
              className="text-4xl sm:text-6xl lg:text-[64px] font-extrabold leading-[1.08] tracking-tight"
            >
              <span className="text-foreground">Practice speaking clearly</span>
              <br />
              <span className="text-primary">before it matters.</span>
            </motion.h1>

            <motion.p
              variants={itemVariants}
              className="text-lg text-muted-foreground leading-relaxed max-w-xl font-medium"
            >
              Practice with live feedback, filler word detection, and coaching insights that help you track patterns and speak with more confidence.
            </motion.p>

            {/* Buttons + Trust badges share the same max-width so edges align */}
            <div className="max-w-md w-full pt-6 space-y-4">
              <motion.div variants={itemVariants} className="flex flex-col gap-3 sm:flex-row sm:gap-4">
                <Button size="lg" className="flex-1 h-14 text-base" asChild>
                  <Link to="/auth/signup" data-testid="start-free-session-button" className="flex items-center justify-center gap-2">
                    Start Practice Session
                    <ArrowRight className="size-5" />
                  </Link>
                </Button>
                <Button variant="secondary" size="lg" className="flex-1 h-14 text-base" asChild>
                  <Link to="/analytics">See How Feedback Works</Link>
                </Button>
              </motion.div>

              <motion.div variants={itemVariants} className="grid grid-cols-1 gap-2 text-sm text-muted-foreground font-medium sm:grid-cols-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary" />
                  <span>Basic to start</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary" />
                  <span>No installation</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary" />
                  <span>Live feedback</span>
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
