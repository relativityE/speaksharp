import * as React from 'react';
import { Mic, BarChart3, Target } from 'lucide-react';

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  iconBgColor: string;
  iconTextColor: string;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ icon, title, description }) => (
  <div className="glass rounded-2xl p-7 group hover:bg-white/10 transition-all duration-300">
    <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-primary/15 text-primary mb-6 transition-transform group-hover:scale-110">
      {icon}
    </div>
    <h3 className="text-xl font-bold text-foreground mb-3">{title}</h3>
    <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
  </div>
);

const features = [
  {
    icon: <Mic className="size-8" />,
    title: "Real-time Analysis",
    description: "Get instant feedback on your speech patterns, filler words, and clarity as you speak.",
    iconBgColor: "bg-primary/10",
    iconTextColor: "text-primary",
  },
  {
    icon: <BarChart3 className="size-8" />,
    title: "Progress Tracking",
    description: "Monitor your improvement over time with detailed analytics and personalized insights.",
    iconBgColor: "bg-primary/10",
    iconTextColor: "text-primary",
  },
  {
    icon: <Target className="size-8" />,
    title: "Goal Setting",
    description: "Set specific speaking goals and track your progress towards better communication.",
    iconBgColor: "bg-primary/10",
    iconTextColor: "text-primary",
  }
]

export const FeaturesSection = () => {
  return (
    <section className="w-full py-24 md:py-32 relative z-10">
      <div className="container px-4 md:px-6 max-w-7xl mx-auto">
        <div className="flex flex-col items-center justify-center space-y-4 text-center mb-16">
          <div className="space-y-4">
             <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass text-primary text-xs font-semibold uppercase tracking-wider mx-auto">
              Features
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-foreground leading-tight">
              Everything you need to <span className="text-gradient-cyan">practice</span>
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-[800px] mx-auto">
              SpeakSharp provides a suite of tools designed to make you a more confident and articulate public speaker.
            </p>
          </div>
        </div>
        <div className="mx-auto grid items-start gap-8 sm:grid-cols-2 md:grid-cols-3">
          {features.map((feature, index) => (
            <FeatureCard key={index} {...feature} />
          ))}
        </div>
      </div>
    </section>
  );
};
