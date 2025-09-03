import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Zap, CheckCircle, Shield } from 'lucide-react';

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  iconBgColor: string;
  iconTextColor: string;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ icon, title, description, iconBgColor, iconTextColor }) => (
  <Card>
    <div className={`w-16 h-16 rounded-xl flex items-center justify-center ${iconBgColor} ${iconTextColor}`}>
      {icon}
    </div>
    <h3 className="text-xl font-semibold text-foreground mt-4">{title}</h3>
    <p className="text-sm text-muted-foreground mt-2">{description}</p>
  </Card>
);

const features = [
    {
        icon: <Zap className="size-8" />,
        title: "Real-time Transcription",
        description: "Get instant transcriptions of your speech as you talk, allowing you to review your words on the fly.",
        iconBgColor: "bg-primary/10",
        iconTextColor: "text-primary",
    },
    {
        icon: <CheckCircle className="size-8" />,
        title: "Filler Word Detection",
        description: "Our core feature. We highlight filler words like 'um', 'ah', and 'like' so you can identify and eliminate them.",
        iconBgColor: "bg-success/10",
        iconTextColor: "text-success",
    },
    {
        icon: <Shield className="size-8" />,
        title: "Privacy Focused",
        description: "Your speech is processed entirely in your browser. No audio data is ever sent to or stored on our servers.",
        iconBgColor: "bg-accent/10",
        iconTextColor: "text-accent",
    }
]

export const FeaturesSection = () => {
  return (
    <section className="w-full py-12 md:py-24 lg:py-32 bg-secondary">
      <div className="container px-4 md:px-6">
        <div className="flex flex-col items-center justify-center space-y-4 text-center">
          <div className="space-y-3">
            <Badge variant="primary" className="text-lg text-white">
              Key Features
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground leading-tight">
              Everything you need to practice
            </h2>
            <p className="text-xl text-muted-foreground leading-relaxed max-w-[900px]">
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
