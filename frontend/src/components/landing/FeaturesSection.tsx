import * as React from 'react';
import { motion } from 'framer-motion';
import { Mic, BarChart3, ShieldCheck } from 'lucide-react';

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  iconBgColor: string;
  iconTextColor: string;
}

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

const FeatureCard: React.FC<FeatureCardProps> = ({ icon, title, description, iconBgColor, iconTextColor }) => (
  <motion.div variants={itemVariants} className="h-full group cursor-pointer">
    <div className="p-8 h-full rounded-lg bg-white border border-border surface-shadow transition-all duration-400 hover:-translate-y-1 hover:border-primary/30">
      <div className={`w-16 h-16 rounded-lg flex items-center justify-center ${iconBgColor} ${iconTextColor} mb-6 group-hover:scale-105 group-hover:bg-primary/30 transition-all duration-400`}>
        {icon}
      </div>
      <h3 className="text-xl font-bold text-foreground transition-colors duration-400">{title}</h3>
      <p className="mt-3 text-sm font-medium leading-relaxed text-foreground/70">{description}</p>
    </div>
  </motion.div>
);

const features = [
  {
    icon: <Mic className="size-8" />,
    title: "Instant Free Practice",
    description: "Start with Browser transcription for quick feedback. Accuracy depends on your browser and room, so Pro adds stronger paths when precision matters.",
    iconBgColor: "bg-primary/20",
    iconTextColor: "text-primary",
  },
  {
    icon: <BarChart3 className="size-8" />,
    title: "Coaching That Goes Deeper",
    description: "Review pacing, fillers, structure, vocabulary variety, and listener takeaway so practice becomes repeatable progress.",
    iconBgColor: "bg-primary/20",
    iconTextColor: "text-primary",
  },
  {
    icon: <ShieldCheck className="size-8" />,
    title: "Private Transcription",
    description: "Try one short Private sample, then continue with paid Early Access. It runs locally after one-time setup, keeping sensitive practice audio in your browser.",
    iconBgColor: "bg-primary/20",
    iconTextColor: "text-primary",
  }
]

export const FeaturesSection = () => {
  return (
    <section aria-label="Key Features" className="w-full py-12 md:py-14 relative overflow-hidden">
      <div className="container px-4 md:px-6 relative z-10">
        <motion.div
          className="flex flex-col items-center justify-center space-y-3 text-center mb-8"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <div className="space-y-3">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700">
              Key Features
            </span>
            <h2 className="text-3xl sm:text-5xl font-bold text-foreground leading-tight tracking-tight mt-3">
              Everything you need to <span className="text-amber-700">practice</span>
            </h2>
            <p className="mt-3 max-w-[760px] text-lg font-medium leading-relaxed text-foreground/70">
              SpeakSharp provides a suite of tools designed for focused speech practice, review, and coaching feedback.
            </p>
          </div>
        </motion.div>

        <motion.div
          className="mx-auto grid max-w-6xl items-start gap-5 sm:grid-cols-2 lg:grid-cols-3 mt-6"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={{
            visible: {
              transition: {
                staggerChildren: 0.15
              }
            }
          }}
        >
          {features.map((feature, index) => (
            <FeatureCard key={index} {...feature} />
          ))}
        </motion.div>
      </div>
    </section>
  );
};
