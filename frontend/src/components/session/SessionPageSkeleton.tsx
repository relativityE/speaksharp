import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

export const SessionPageSkeleton: React.FC = () => {
    return (
        <div className="min-h-screen bg-background" data-testid="session-page-skeleton">
            {/* Header Skeleton */}
            <div className="flex items-center justify-between py-8 px-6 max-w-7xl mx-auto">
                <div className="space-y-2">
                    <Skeleton className="h-10 w-64" />
                    <Skeleton className="h-4 w-96" />
                </div>
                <Skeleton className="h-10 w-10" />
            </div>

            <div className="max-w-7xl mx-auto px-6 pb-12 space-y-6">
                {/* Live Recording Card Skeleton */}
                <Card className="p-8 border-2 border-white/5 shadow-card">
                    <div className="flex justify-between mb-6">
                        <Skeleton className="h-8 w-40" />
                        <Skeleton className="h-6 w-20" />
                    </div>

                    <div className="flex flex-col items-center py-12 gap-6">
                        <Skeleton className="w-24 h-24 rounded-full" />
                        <Skeleton className="h-12 w-32" />
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-14 w-48" />
                    </div>
                </Card>

                {/* Metrics Grid Skeleton */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Clarity Score */}
                    <Card className="p-8 border-2 border-white/5 shadow-card">
                        <Skeleton className="h-6 w-32 mb-6" />
                        <div className="flex flex-col items-center gap-2">
                            <Skeleton className="h-16 w-24" />
                            <Skeleton className="h-4 w-32" />
                        </div>
                    </Card>

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
};
