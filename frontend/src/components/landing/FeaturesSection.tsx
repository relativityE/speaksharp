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
    title: "Open Mic",
    description: "Start a Private practice recording whenever you are ready. Speak freely, then review the transcript and coaching.",
    iconBgColor: "bg-primary/20",
    iconTextColor: "text-primary",
  },
  {
    icon: <BarChart3 className="size-8" />,
    title: "Focus Points",
    description: "Optionally name the points you want to cover, then see which were detected and what to retry.",
    iconBgColor: "bg-primary/20",
    iconTextColor: "text-primary",
  },
  {
    icon: <ShieldCheck className="size-8" />,
    title: "Private by design",
    description: "Every customer recording uses on-device Private transcription. Trial and paid access provide the same complete product.",
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
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-900">
              How it works
            </span>
            <h2 className="text-3xl sm:text-5xl font-bold text-foreground leading-tight tracking-tight mt-3">
              Practice privately. Improve with <span className="text-amber-700">clear feedback</span>.
            </h2>
            <p className="mt-3 max-w-[760px] text-lg font-medium leading-relaxed text-foreground/70">
              Use Open Mic as your default, add Focus Points when useful, and leave each session with one next action.
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
