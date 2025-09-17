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
import { supabase } from "@/lib/supabaseClient";
import logger from "@/lib/logger";

interface UpgradePromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const UpgradePromptDialog: React.FC<UpgradePromptDialogProps> = ({ open, onOpenChange }) => {

  const handleUpgrade = async () => {
    try {
        const { data, error } = await supabase.functions.invoke('stripe-checkout');
        if (error) throw error;
        // The edge function returns a URL to the Stripe checkout page
        if (data.checkoutUrl) {
            window.location.href = data.checkoutUrl;
        }
    } catch (err: any) {
        logger.error({err}, 'Error creating Stripe checkout session:');
        // You might want to show an error message to the user here
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unlock Your Full Potential</AlertDialogTitle>
          <AlertDialogDescription>
            You've had a great session! Upgrade to Pro to save your full session history, get advanced analytics, and practice without limits.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Maybe Later</AlertDialogCancel>
          <AlertDialogAction onClick={handleUpgrade}>Upgrade to Pro</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
