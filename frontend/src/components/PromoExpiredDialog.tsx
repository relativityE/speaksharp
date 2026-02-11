import { useState } from 'react';
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseClient } from "@/lib/supabaseClient";
import logger from "@/lib/logger";
import { toast } from '@/lib/toast';
import { useQueryClient } from '@tanstack/react-query';

interface PromoExpiredDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * Dialog shown when a user's promo Pro access expires.
 * Prompts them to either upgrade to a paid plan or continue as Free.
 */
export const PromoExpiredDialog: React.FC<PromoExpiredDialogProps> = ({ open, onOpenChange }) => {
    const [showPromo, setShowPromo] = useState(false);
    const [promoCode, setPromoCode] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const queryClient = useQueryClient();

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

    const handlePromoSubmit = async () => {
        if (!promoCode.trim()) return;
        setIsSubmitting(true);
        try {
            const supabase = getSupabaseClient();
            if (!supabase) throw new Error("Supabase client not available");

            const { data, error } = await supabase.functions.invoke('apply-promo', {
                body: { promoCode }
            });

            if (error) throw error;

            toast.success(data.message || "Promo code applied successfully!");
            // Refresh user profile to reflect new status
            await queryClient.invalidateQueries({ queryKey: ['userProfile'] });
            onOpenChange(false); // Close dialog

            toast.error("Invalid or expired promo code.");
        } catch (err: unknown) {
            logger.error({ err }, 'Error applying promo code:');
            const msg = err instanceof Error ? err.message : "Failed to apply promo code";
            // If the error object has a 'message' property from Supabase Functions invoke
            // It often comes as an Error object with the JSON response
            toast.error(msg);
        } finally {
            setIsSubmitting(false);
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

                {showPromo && (
                    <div className="py-2 space-y-2 animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex gap-2">
                            <Input
                                placeholder="Enter promo code"
                                value={promoCode}
                                onChange={(e) => setPromoCode(e.target.value)}
                                className="h-8 text-sm"
                            />
                            <Button
                                size="sm"
                                onClick={handlePromoSubmit}
                                disabled={isSubmitting || !promoCode.trim()}
                            >
                                {isSubmitting ? 'Applying...' : 'Apply'}
                            </Button>
                        </div>
                    </div>
                )}

                <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                    {!showPromo && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-muted-foreground mr-auto"
                            onClick={() => setShowPromo(true)}
                        >
                            Have a promo code?
                        </Button>
                    )}
                    <div className="flex gap-2 justify-end w-full sm:w-auto">
                        <AlertDialogCancel data-testid="promo-expired-continue-free">Continue as Free</AlertDialogCancel>
                        <AlertDialogAction onClick={handleUpgrade} data-testid="promo-expired-upgrade-button">Upgrade to Pro</AlertDialogAction>
                    </div>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
