import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Lightbulb, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const TIPS = [
    {
        title: "Pause for Effect",
        description: "Silence is powerful. Use pauses to emphasize key points and give your audience time to process information."
    },
    {
        title: "Watch Your Pace",
        description: "Aim for 130-150 words per minute. Speaking too fast can reduce clarity, while too slow can lose engagement."
    },
    {
        title: "Eliminate Filler Words",
        description: "Replace 'um' and 'ah' with a breath or a pause. It makes you sound more confident and prepared."
    },
    {
        title: "Vary Your Tone",
        description: "Monotone speech is boring. Use pitch and volume changes to convey emotion and keep attention."
    },
    {
        title: "Eye Contact",
        description: "Even on a call, look at the camera occasionally to simulate eye contact with your audience."
    }
];

export const SpeakingTips: React.FC = () => {
    const [currentTipIndex, setCurrentTipIndex] = useState(0);

    const nextTip = () => {
        setCurrentTipIndex((prev) => (prev + 1) % TIPS.length);
    };

    // Auto-rotate tips every 30 seconds
    useEffect(() => {
        const interval = setInterval(nextTip, 30000);
        return () => clearInterval(interval);
    }, []);

    const tip = TIPS[currentTipIndex];

    return (
        <Card className="bg-secondary/20 border-secondary/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-yellow-500" />
                    Speaking Tip
                </CardTitle>
                <Button variant="ghost" size="icon" onClick={nextTip} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                    <RefreshCw className="h-4 w-4" />
                    <span className="sr-only">Next Tip</span>
                </Button>
            </CardHeader>
            <CardContent>
                <h4 className="font-semibold text-foreground mb-1">{tip.title}</h4>
                <p className="text-sm text-muted-foreground">{tip.description}</p>
            </CardContent>
        </Card>
    );
};
