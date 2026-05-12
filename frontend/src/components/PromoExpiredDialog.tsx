import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { getSupabaseClient } from "@/lib/supabaseClient";
import logger from "@/lib/logger";
import { toast } from '@/lib/toast';

interface PromoExpiredDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * Dialog shown when a user's promo Pro access expires.
 * Prompts them to either upgrade to a paid plan or continue on Basic.
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

    const handleContinue = () => {
        onOpenChange(false);
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="border-border/70 bg-card sm:max-w-md">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-foreground">Your Pro Trial Has Ended</AlertDialogTitle>
                    <AlertDialogDescription className="text-muted-foreground">
                        Your temporary Pro access has expired. Upgrade now to continue using Pro features like private transcription, cloud transcription, AI feedback, and deeper history.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:space-x-0">
                    <AlertDialogCancel
                        className="m-0 h-11 w-full justify-center"
                        onClick={handleContinue}
                        data-testid="promo-expired-continue-free"
                    >
                        Continue as Basic
                    </AlertDialogCancel>
                    <Button
                        className="h-11 w-full"
                        onClick={() => { void handleUpgrade(); }}
                        data-testid="promo-expired-upgrade-button"
                    >
                        Upgrade to Pro
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
