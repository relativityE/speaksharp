import * as React from 'react';
import { Card } from '@/components/ui/card';
import { Star } from 'lucide-react';

const TestimonialCard: React.FC = () => (
  <Card className="p-6">
    <div className="flex mb-3">
      {[...Array(5)].map((_, i) => <Star key={i} className="size-4 fill-secondary text-secondary" />)}
    </div>
    <p className="text-muted-foreground">"TBD for now"</p>
    <div className="mt-4">
      <h3 className="font-semibold text-foreground">TBD for now</h3>
      <p className="text-sm text-muted-foreground">TBD for now</p>
    </div>
  </Card>
);

export const TestimonialsSection = () => {
  return (
    <section className="w-full py-12 md:py-16">
      <div className="container px-4 md:px-6 max-w-6xl mx-auto">
        <div className="grid sm:grid-cols-2 gap-6">
          <TestimonialCard />
          <TestimonialCard />
        </div>
      </div>
    </section>
  );
};
