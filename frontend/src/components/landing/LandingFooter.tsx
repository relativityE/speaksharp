import * as React from 'react';
import { Link } from 'react-router-dom';
import { Mic } from 'lucide-react';

export const LandingFooter = () => {
  return (
    <footer className="w-full py-20 px-4 md:px-6 bg-background border-t border-white/5 relative overflow-hidden">
      <div className="container mx-auto max-w-7xl relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="md:col-span-2 space-y-6">
            <div className="flex items-center gap-2 group cursor-pointer w-fit">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center glow-primary transition-transform group-hover:scale-110">
                <Mic className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold text-foreground tracking-tight">SpeakSharp</span>
            </div>
            <p className="text-muted-foreground max-w-sm leading-relaxed">
              Master your communication with real-time AI feedback. Practice anytime, anywhere.
            </p>
          </div>

          <div className="space-y-6">
            <h4 className="font-bold text-foreground text-lg">Product</h4>
            <ul className="space-y-3">
              <li><Link to="/session" className="text-muted-foreground hover:text-primary transition-colors">Practice</Link></li>
              <li><Link to="/analytics" className="text-muted-foreground hover:text-primary transition-colors">Analytics</Link></li>
            </ul>
          </div>

          <div className="space-y-6">
            <h4 className="font-bold text-foreground text-lg">Legal</h4>
            <ul className="space-y-3">
              <li><Link to="/privacy" className="text-muted-foreground hover:text-primary transition-colors">Privacy Policy</Link></li>
              <li><Link to="/terms" className="text-muted-foreground hover:text-primary transition-colors">Terms of Service</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-20 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-6">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} SpeakSharp. All rights reserved.
          </p>
          <div className="flex gap-8">
          </div>
        </div>
      </div>
    </footer>
  );
};
