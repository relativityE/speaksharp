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
                            You've reached today's practice limit. Your brain needs time to absorb all that progress!
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-6 text-center font-medium text-foreground/70">
                        <p>We'll see you tomorrow for your next session!</p>
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
                        You've reached this month's practice limit. You are a practice machine!
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="py-6 text-center font-medium text-foreground/70" />
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
