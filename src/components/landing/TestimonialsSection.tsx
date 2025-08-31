import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Star } from 'lucide-react';

interface TestimonialCardProps {
  quote: string;
  author: string;
}

const TestimonialCard: React.FC<TestimonialCardProps> = ({ quote, author }) => (
  <Card>
    <p className="text-lg text-muted-foreground mt-4">"{quote}"</p>
    <div className="flex items-center gap-4 mt-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground">{author}</h3>
        <div className="flex mt-1">
          {[...Array(5)].map((_, i) => <Star key={i} className="size-4 fill-accent text-accent" />)}
        </div>
      </div>
    </div>
  </Card>
);

const testimonials = [
    {
        quote: "TBD",
        author: "TBD",
    },
    {
        quote: "TBD",
        author: "TBD",
    }
]

export const TestimonialsSection = () => {
  return (
    <section className="w-full py-12 md:py-24 lg:py-32 bg-background">
      <div className="container px-4 md:px-6">
        <div className="flex flex-col items-center justify-center space-y-4 text-center">
          <div className="space-y-3">
            <Badge variant="accent" size="md">
              Testimonials
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground leading-tight">
              Trusted by Professionals
            </h2>
          </div>
        </div>
        <div className="mx-auto grid max-w-5xl items-start gap-12 sm:grid-cols-2 lg:gap-16 mt-12">
            {testimonials.map((testimonial, index) => (
                <TestimonialCard key={index} {...testimonial} />
            ))}
        </div>
      </div>
    </section>
  );
};
