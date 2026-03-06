import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Mic, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

interface HeroStatsDashboardProps {
    className?: string;
}

// Demo stats that count up on page load
const demoStats = {
    clarity: 85,      // percentage
    fillers: 3,       // count
    wpm: 142,         // words per minute
    duration: "2:34"  // time string
};

// Animated counter hook
function useCountUp(target: number, duration: number = 2000) {
    const [count, setCount] = useState(0);

    useEffect(() => {
        const startTime = Date.now();
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.floor(eased * target));

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };
        requestAnimationFrame(animate);
    }, [target, duration]);

    return count;
}

// Mini bar chart visualization
const MiniBars = () => {
    const bars = [1, 3, 5, 7, 5, 3, 1, 3, 5, 7, 5, 3, 1];

    return (
        <div className="flex items-end gap-1 h-8 justify-center">
            {bars.map((height, i) => (
                <motion.div
                    key={i}
                    className="w-2 bg-gradient-to-t from-primary/60 to-primary rounded-sm"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{
                        height: `${height * 4}px`,
                        opacity: 1
                    }}
                    transition={{
                        delay: 0.5 + i * 0.05,
                        duration: 0.3,
                        ease: "easeOut"
                    }}
                />
            ))}
        </div>
    );
};

// Stat card component
const StatCard = ({
    value,
    label,
    suffix = "",
    delay = 0,
    colorClass = "text-primary"
}: {
    value: string | number;
    label: string;
    suffix?: string;
    delay?: number;
    colorClass?: string;
}) => (
    <motion.div
        className="bg-card/50 rounded-xl p-4 border border-white/5 backdrop-blur-sm"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay, duration: 0.4, ease: "easeOut" }}
    >
        <div className={`text-3xl font-bold ${colorClass}`}>
            {value}{suffix}
        </div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mt-1">{label}</div>
    </motion.div>
);

export const HeroStatsDashboard = ({ className = "" }: HeroStatsDashboardProps) => {
    const clarityCount = useCountUp(demoStats.clarity, 2000);
    const fillersCount = useCountUp(demoStats.fillers, 1500);
    const wpmCount = useCountUp(demoStats.wpm, 2000);

    return (
        <div className={`relative ${className}`}>
            {/* Main Dashboard Card */}
            <motion.div
                className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl p-6 md:p-8"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-8 pb-4 border-b border-white/5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                            <Mic className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                            <div className="font-bold text-foreground">Live Demo Session</div>
                            <div className="text-xs font-medium text-primary">Real-time analysis</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-success/10 border border-success/20">
                        <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                        <span className="text-[10px] font-bold text-success uppercase tracking-wider">Live</span>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-4 mb-8">
                    <StatCard value={clarityCount} suffix="%" label="Clarity" delay={0.1} colorClass="text-primary" />
                    <StatCard value={fillersCount} label="Fillers" delay={0.2} colorClass="text-secondary" />
                    <StatCard value={wpmCount} label="WPM" delay={0.3} colorClass="text-primary" />
                    <StatCard value={demoStats.duration} label="Duration" delay={0.4} colorClass="text-secondary" />
                </div>

                {/* Mini Bars Visualization */}
                <div className="mb-8 py-2">
                    <MiniBars />
                </div>

                {/* CTA Button */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.8, duration: 0.3 }}
                >
                    <Button
                        variant="secondary"
                        size="lg"
                        className="w-full bg-secondary text-secondary-foreground font-bold h-14 rounded-xl shadow-elegant hover:bg-secondary/90 transition-all flex items-center justify-center gap-3"
                        asChild
                    >
                        <Link to="/auth/signup">
                            <Mic className="w-5 h-5" />
                            Start Speaking
                        </Link>
                    </Button>
                </motion.div>
            </motion.div>

            {/* Floating Real-time Badge */}
            <motion.div
                className="absolute -bottom-3 -right-3 md:-bottom-2 md:-right-4 bg-white/[0.06] backdrop-blur-xl rounded-xl px-4 py-2.5 flex items-center gap-2.5 border border-white/10 shadow-2xl"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 1, duration: 0.4, ease: "easeOut" }}
            >
                <div className="w-8 h-8 rounded-lg bg-secondary/10 flex items-center justify-center">
                    <Zap className="w-4 h-4 text-secondary fill-current" />
                </div>
                <span className="text-sm font-bold text-primary tracking-tight">Real-time AI</span>
            </motion.div>
        </div>
    );
};

export default HeroStatsDashboard;
