import React from 'react';
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Zap, Trophy, Flame } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { arePaymentsEnabled } from '@/config/appRuntimeConfig';

interface SunsetModalsProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    type: 'daily' | 'monthly';
    isPro: boolean;
}

export const SunsetModals: React.FC<SunsetModalsProps> = ({ open, onOpenChange, type, isPro }) => {
    const navigate = useNavigate();
    // Only offer upgrade when payments are live — otherwise no dead button / broken /pricing route.
    const canUpgrade = !isPro && arePaymentsEnabled();

    const Content = () => {
        if (type === 'daily') {
            return (
                <>
                    <AlertDialogHeader>
                        <div className="flex justify-center mb-4">
                            <div className="bg-orange-100 p-3 rounded-full">
                                <Flame className="w-12 h-12 text-orange-500" />
                            </div>
                        </div>
                        <AlertDialogTitle className="text-2xl text-center">Daily Target Crushed! 👏</AlertDialogTitle>
                        <AlertDialogDescription className="text-center text-lg pt-2">
                            {isPro
                                ? "You've maximized your 2-hour Pro training window today. Your brain needs time to absorb all that progress!"
                                : "You've maximized your 1-hour Free training window today. Great focus!"
                            }
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-6 text-center font-medium text-foreground/70">
                        {canUpgrade && (
                            <p className="font-semibold text-primary">Want double the daily bandwidth? Upgrade to Pro for 2 full hours of practice.</p>
                        )}
                        {isPro && (
                            <p>We'll see you tomorrow for your next high-performance session!</p>
                        )}
                    </div>
                </>
            );
        }

        return (
            <>
                <AlertDialogHeader>
                    <div className="flex justify-center mb-4">
                        <div className="bg-blue-100 p-3 rounded-full">
                            <Trophy className="w-12 h-12 text-blue-500" />
                        </div>
                    </div>
                    <AlertDialogTitle className="text-2xl text-center">Top 1% Achievement Unlocked! 🏆</AlertDialogTitle>
                    <AlertDialogDescription className="text-center text-lg pt-2">
                        {isPro
                            ? "You've utilized your full 50-hour Pro allowance this month. You are a practice machine!"
                            : "You've maximized your 25-hour Free allowance. You're out-practicing almost everyone!"
                        }
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="py-6 text-center font-medium text-foreground/70">
                    {canUpgrade && (
                        <p className="font-semibold text-primary">Upgrade to Pro to lock in 50 hours/month and advanced speech analytics.</p>
                    )}
                </div>
            </>
        );
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="sm:max-w-md">
                <Content />
                <AlertDialogFooter className="sm:justify-center gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                    {canUpgrade && (
                        <Button className="font-bold bg-primary hover:bg-primary/90" onClick={() => navigate('/pricing')}>
                            <Zap className="w-4 h-4 mr-2" /> Upgrade to Pro
                        </Button>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
