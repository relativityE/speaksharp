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
import { toast } from '@/lib/toast';

interface UpgradePromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const UpgradePromptDialog: React.FC<UpgradePromptDialogProps> = ({ open, onOpenChange }) => {

  const handleUpgrade = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase client not available");
      const { data, error } = await supabase.functions.invoke('stripe-checkout');
      if (error) throw error;
      // The edge function returns a URL to the Stripe checkout page
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
          <AlertDialogTitle>Unlock Your Full Potential</AlertDialogTitle>
          <AlertDialogDescription>
            You've had a great session! Upgrade to a paid plan to save your full session history, get advanced analytics, and practice without limits.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Maybe Later</AlertDialogCancel>
          <AlertDialogAction onClick={handleUpgrade} data-testid="upgrade-prompt-dialog-upgrade-button">View Plans</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
