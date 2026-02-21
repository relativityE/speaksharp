import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
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
    <div className={`w-12 h-12 rounded-xl flex items-center justify-center bg-primary/15 text-primary mb-6 transition-transform group-hover:scale-110`}>
      {icon}
    </div>
    <h3 className="text-xl font-bold text-foreground mb-3">{title}</h3>
    <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
  </div>
);

const features = [
  {
    icon: <Mic className="size-6" />,
    title: "Real-time Analysis",
    description: "Get instant feedback on your speech patterns, filler words, and clarity as you speak.",
  },
  {
    icon: <BarChart3 className="size-6" />,
    title: "Progress Tracking",
    description: "Monitor your improvement over time with detailed analytics and personalized insights.",
  },
  {
    icon: <Target className="size-6" />,
    title: "Goal Setting",
    description: "Set specific speaking goals and track your progress towards better communication.",
  }
]

export const FeaturesSection = () => {
  return (
    <section className="relative w-full py-24 md:py-32">
      <div className="container px-4 md:px-6 max-w-7xl mx-auto">
        <div className="flex flex-col items-center justify-center space-y-4 text-center mb-16">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass text-primary text-sm font-medium mx-auto">
              Key Features
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold text-foreground leading-tight">
              Everything you need to <span className="text-gradient-cyan">practice</span>
            </h2>
            <p className="text-xl text-muted-foreground leading-relaxed max-w-3xl mx-auto">
              SpeakSharp provides a suite of tools designed to make you a more confident and articulate public speaker.
            </p>
          </div>
        </div>
        <div className="mx-auto grid max-w-5xl items-start gap-12 sm:grid-cols-2 md:grid-cols-3 lg:gap-16 mt-12">
          {features.map((feature, index) => (
            <FeatureCard key={index} {...feature} />
          ))}
        </div>

      </div>
    </section>
  );
};
