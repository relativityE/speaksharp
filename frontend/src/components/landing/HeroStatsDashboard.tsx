import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Mic } from 'lucide-react';
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
                    className="w-2 bg-gradient-to-t from-amber-600/70 to-amber-700 rounded-sm"
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
    colorClass = "text-amber-700"
}: {
    value: string | number;
    label: string;
    suffix?: string;
    delay?: number;
    colorClass?: string;
}) => (
    <motion.div
        className="bg-white rounded-xl p-4 border border-border shadow-sm"
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
                className="bg-white rounded-lg border border-border shadow-card p-6 md:p-8"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-8 pb-4 border-b border-border">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Mic className="w-5 h-5 text-amber-700" />
                        </div>
                        <div>
                            <div className="font-bold text-foreground">Live Demo Session</div>
                            <div className="text-xs font-medium text-amber-700">Real-time analysis</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-success/12 border border-success/25">
                        <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                        <span className="text-[10px] font-bold text-success uppercase tracking-wider">Live</span>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-4 mb-8">
                    <StatCard value={clarityCount} suffix="%" label="Clarity" delay={0.1} colorClass="text-amber-700" />
                    <StatCard value={fillersCount} label="Fillers" delay={0.2} colorClass="text-amber-700" />
                    <StatCard value={wpmCount} label="WPM" delay={0.3} colorClass="text-amber-700" />
                    <StatCard value={demoStats.duration} label="Duration" delay={0.4} colorClass="text-foreground" />
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
                        variant="default"
                        size="lg"
                        className="w-full h-14 flex items-center justify-center gap-3"
                        asChild
                    >
                        <Link to="/auth/signup">
                            <Mic className="w-5 h-5" />
                            Start Practice Session
                        </Link>
                    </Button>
                </motion.div>
            </motion.div>
        </div>
    );
};

export default HeroStatsDashboard;
