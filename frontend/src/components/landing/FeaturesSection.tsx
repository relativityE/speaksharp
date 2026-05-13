import * as React from 'react';
import { motion } from 'framer-motion';
import { Mic, BarChart3, Target } from 'lucide-react';

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
    <div className="p-8 h-full rounded-lg bg-white border border-border transition-all duration-400 hover:-translate-y-1 hover:shadow-card hover:border-primary/30">
      <div className={`w-16 h-16 rounded-lg flex items-center justify-center ${iconBgColor} ${iconTextColor} mb-6 group-hover:scale-105 group-hover:bg-primary/30 transition-all duration-400`}>
        {icon}
      </div>
      <h3 className="text-xl font-bold text-foreground transition-colors duration-400">{title}</h3>
      <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{description}</p>
    </div>
  </motion.div>
);

const features = [
  {
    icon: <Mic className="size-8" />,
    title: "Real-time Analysis",
    description: "Get live practice feedback on speech patterns, filler words, and clarity as you speak.",
    iconBgColor: "bg-primary/20",
    iconTextColor: "text-primary",
  },
  {
    icon: <BarChart3 className="size-8" />,
    title: "Progress Tracking",
    description: "Review saved sessions and compare speaking metrics as you practice over time.",
    iconBgColor: "bg-primary/20",
    iconTextColor: "text-primary",
  },
  {
    icon: <Target className="size-8" />,
    title: "Goal Setting",
    description: "Set specific speaking goals and track your progress towards better communication.",
    iconBgColor: "bg-primary/20",
    iconTextColor: "text-primary",
  }
]

export const FeaturesSection = () => {
  return (
    <section aria-label="Key Features" className="w-full py-24 md:py-32 relative overflow-hidden">
      <div className="container px-4 md:px-6 relative z-10">
        <motion.div
          className="flex flex-col items-center justify-center space-y-4 text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <div className="space-y-3">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">
              Key Features
            </span>
            <h2 className="text-3xl sm:text-5xl font-bold text-foreground leading-tight tracking-tight mt-4">
              Everything you need to <span className="text-primary">practice</span>
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-[800px] mt-4">
              SpeakSharp provides a suite of tools designed for focused speech practice, review, and coaching feedback.
            </p>
          </div>
        </motion.div>

        <motion.div
          className="mx-auto grid max-w-6xl items-start gap-8 sm:grid-cols-2 lg:grid-cols-3 mt-12"
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
