import React from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getSupabaseClient } from "@/lib/supabaseClient";
import logger from "@/lib/logger";
import { toast } from "sonner";

interface PromoExpiredDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * Dialog shown when a user's promo Pro access expires.
 * Prompts them to either upgrade to a paid plan or continue as Free.
 */
export const PromoExpiredDialog: React.FC<PromoExpiredDialogProps> = ({ open, onOpenChange }) => {

    const handleUpgrade = async () => {
        try {
            const supabase = getSupabaseClient();
            if (!supabase) throw new Error("Supabase client not available");
            const { data, error } = await supabase.functions.invoke('stripe-checkout');
            if (error) throw error;
            if (data?.checkoutUrl && typeof data.checkoutUrl === 'string' && data.checkoutUrl.startsWith('https://checkout.stripe.com')) {
                window.location.href = data.checkoutUrl;
            } else {
                const errorMsg = data?.checkoutUrl ? "Security Error: Invalid checkout URL" : "No checkout URL returned";
                toast.error(errorMsg);
                throw new Error(errorMsg);
            }
        } catch (err: unknown) {
            logger.error({ err }, 'Error creating Stripe checkout session:');
            toast.error("Subscription failed. Please try again later.");
        }
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Your Pro Trial Has Ended</AlertDialogTitle>
                    <AlertDialogDescription>
                        Your 30-minute Pro access has expired. Upgrade now to continue using Pro features like Private Whisper and unlimited sessions.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel data-testid="promo-expired-continue-free">Continue as Free</AlertDialogCancel>
                    <AlertDialogAction onClick={handleUpgrade} data-testid="promo-expired-upgrade-button">Upgrade to Pro</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
