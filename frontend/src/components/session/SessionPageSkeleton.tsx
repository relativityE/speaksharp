
import React, { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

const LOADING_TIPS = [
    "Tip: Pause instead of using filler words like 'um' or 'ah'.",
    "Did you know? Speaking slowly (120-150 wpm) improves clarity.",
    "Tip: Vary your tone to keep your audience engaged.",
    "Fact: Eye contact (even with a camera) builds trust.",
    "Tip: Take a deep breath before starting to calm nerves.",
    "Tip: Structure your points: Tell them what you're going to say, say it, then tell them what you said."
];

export function SessionPageSkeleton() {
    const [tip, setTip] = useState("");

    useEffect(() => {
        setTip(LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)]);
    }, []);

    return (
        <div className="min-h-screen bg-background" data-testid="session-page-skeleton">
            {/* Header Skeleton */}
            <div className="flex items-center justify-between py-8 px-6 max-w-7xl mx-auto">
                <div className="space-y-2">
                    <Skeleton className="h-10 w-64" />
                    <Skeleton className="h-4 w-96" />
                </div>
                <Skeleton className="h-10 w-10 rounded-md" />
            </div>

            <div className="max-w-7xl mx-auto px-6 pb-12 space-y-6">
                {/* Main Card Skeleton */}
                <div className="bg-card border-2 border-white/5 rounded-lg h-[400px] flex flex-col items-center justify-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-50" />

                    {/* Centered Loading State with Tip */}
                    <div className="z-10 flex flex-col items-center space-y-6 max-w-md text-center p-6 animate-fade-in">
                        <Skeleton className="h-24 w-24 rounded-full" />
                        <div className="space-y-4 w-full">
                            <Skeleton className="h-8 w-48 mx-auto" />
                            <div className="space-y-2 pt-4">
                                <p className="text-sm font-medium text-primary/80 uppercase tracking-widest">Preparing your session</p>
                                <p className="text-lg text-muted-foreground italic transition-opacity duration-500 min-h-[3rem]">
                                    "{tip}"
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Metrics Grid Skeleton */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Skeleton className="h-48 rounded-lg" />
                    <Skeleton className="h-48 rounded-lg" />
                    <Skeleton className="h-48 rounded-lg" />
                    <Skeleton className="h-48 rounded-lg" />

                    {/* Speaking Rate */}
                    <Card className="p-8 border-2 border-white/5 shadow-card">
                        <Skeleton className="h-6 w-32 mb-6" />
                        <div className="flex flex-col items-center gap-2">
                            <Skeleton className="h-16 w-24" />
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-6 w-20" />
                        </div>
                    </Card>

                    {/* Filler Words */}
                    <Card className="p-8 border-2 border-white/5 shadow-card">
                        <Skeleton className="h-6 w-32 mb-6" />
                        <div className="flex flex-col items-center gap-2">
                            <Skeleton className="h-16 w-12" />
                            <Skeleton className="h-4 w-40" />
                        </div>
                        <div className="mt-4 flex gap-2">
                            <Skeleton className="h-6 w-16" />
                            <Skeleton className="h-6 w-16" />
                            <Skeleton className="h-6 w-16" />
                        </div>
                    </Card>

                    {/* Speaking Tips */}
                    <Card className="p-8 border-2 border-white/5 shadow-card">
                        <Skeleton className="h-6 w-32 mb-6" />
                        <div className="space-y-4">
                            <Skeleton className="h-16 w-full" />
                            <Skeleton className="h-16 w-full" />
                            <Skeleton className="h-16 w-full" />
                        </div>
                    </Card>

                    {/* Transcript Skeleton */}
                    <Card className="p-8 border-2 border-white/5 shadow-card md:col-span-2">
                        <Skeleton className="h-6 w-40 mb-6" />
                        <Skeleton className="h-[250px] w-full" />
                    </Card>
                </div>
            </div>
        </div>
    );
}
