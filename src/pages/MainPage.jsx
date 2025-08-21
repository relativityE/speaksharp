import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ArrowRight, Download } from 'lucide-react';

// Placeholder data - in a real app, this would come from a CMS or API
const skills = ['React', 'TypeScript', 'Node.js', 'Supabase', 'Tailwind CSS', 'Figma', 'Deno', 'GraphQL'];
const projects = [
  {
    title: 'AI-Powered Sales Coach',
    description: 'A real-time sales call analysis platform that provides feedback to sales reps.',
    tech: ['Next.js', 'Supabase', 'AssemblyAI'],
  },
  {
    title: 'E-commerce Platform',
    description: 'A scalable e-commerce site with a custom CMS and Stripe integration.',
    tech: ['React', 'Node.js', 'PostgreSQL'],
  },
  {
    title: 'Design System for FinTech',
    description: 'A comprehensive component library to ensure brand consistency across products.',
    tech: ['React', 'Storybook', 'Figma'],
  },
];

const stats = [
  { value: '50+', label: 'Projects Completed' },
  { value: '5+', label: 'Years Experience' },
  { value: '30+', label: 'Happy Clients' },
];

// Reusable Section component
const Section = ({ title, children, className = '' }) => (
  <section className={`py-20 ${className}`}>
    <div className="container mx-auto px-4">
      <h2 className="text-3xl font-bold text-center mb-12 text-primary" style={{ textShadow: '0 0 10px hsl(var(--primary)_/_0.3)' }}>{title}</h2>
      {children}
    </div>
  </section>
);

export const MainPage = () => {
  return (
    <div className="text-foreground animate-fade-in-up">
      {/* Hero Section */}
      <section className="h-screen flex items-center justify-center text-center -mt-16 relative overflow-hidden">
        <div className="container mx-auto z-10">
          <div className="absolute inset-0 -z-10 h-full w-full bg-background bg-[linear-gradient(to_right,hsl(var(--border)_/_0.1)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)_/_0.1)_1px,transparent_1px)] bg-[size:32px_32px]"></div>
          <div className="absolute -top-1/4 left-1/2 -z-10 h-96 w-96 -translate-x-1/2 rounded-full bg-[radial-gradient(circle_farthest-side,hsl(var(--primary)_/_0.15),transparent)] blur-3xl animate-pulse"></div>

          <h1 className="text-5xl font-bold mb-4" style={{ textShadow: '0 0 20px hsl(var(--primary)_/_0.5)' }}>
            Full Stack Developer
          </h1>
          <p className="max-w-3xl mx-auto mb-8 text-lg text-muted-foreground">
            Crafting innovative digital experiences with cutting-edge technologies. Specialized in building scalable applications that push the boundaries of what's possible.
          </p>
          <div className="flex justify-center gap-4">
            <Button size="lg" className="shadow-[0_0_20px_hsl(var(--primary)_/_0.5)] transition-all duration-300 hover:shadow-[0_0_35px_hsl(var(--primary)_/_0.7)] hover:scale-105">
              Get In Touch <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button size="lg" variant="outline">
              Download CV <Download className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </div>
      </section>

      {/* Skills Section */}
      <Section title="Technical Skills">
        <div className="flex flex-wrap justify-center gap-4 max-w-4xl mx-auto">
          {skills.map(skill => (
            <div key={skill} className="bg-card border border-border/50 px-6 py-3 rounded-full text-base font-medium transition-all hover:border-primary/50 hover:text-primary hover:scale-105 cursor-pointer">
              {skill}
            </div>
          ))}
        </div>
      </Section>

      {/* Projects Section */}
      <Section title="Featured Projects" className="bg-card/20">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {projects.map((project, index) => (
            <Card key={index} className="bg-card border-border/50 hover:border-primary/50 transition-all duration-300 transform hover:-translate-y-2 shadow-lg hover:shadow-primary/10">
              <CardHeader>
                <CardTitle>{project.title}</CardTitle>
                <CardDescription>{project.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {project.tech.map(t => <div key={t} className="text-xs bg-secondary px-2 py-1 rounded-md">{t}</div>)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      {/* Stats Section */}
      <Section title="My Impact">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center max-w-5xl mx-auto">
          {stats.map(stat => (
            <div key={stat.label} className="bg-card p-8 rounded-lg border border-border/50 transition-all hover:shadow-xl hover:shadow-primary/10">
              <p className="text-4xl font-bold text-primary mb-2">{stat.value}</p>
              <p className="text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Contact CTA */}
      <section className="py-24 text-center">
        <div className="container mx-auto">
          <h2 className="text-3xl font-bold mb-4">Ready to Build Something Amazing?</h2>
          <p className="max-w-2xl mx-auto mb-8 text-muted-foreground">
            Let's discuss your next project and bring your ideas to life.
          </p>
          <Button size="lg" className="shadow-[0_0_20px_hsl(var(--primary)_/_0.5)] transition-all duration-300 hover:shadow-[0_0_35px_hsl(var(--primary)_/_0.7)] hover:scale-105">
            Start a Project
          </Button>
        </div>
      </section>
    </div>
  );
};
