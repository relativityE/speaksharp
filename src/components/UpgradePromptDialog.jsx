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

export function UpgradePromptDialog({ open, onOpenChange }) {

  const handleUpgrade = async () => {
    try {
        const { data, error } = await supabase.functions.invoke('stripe-checkout');
        if (error) throw error;
        // The edge function returns a URL to the Stripe checkout page
        window.location.href = data.checkoutUrl;
    } catch (error) {
        logger.error({error}, 'Error creating Stripe checkout session:');
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
          <AlertDialogAction onClick={handleUpgrade} data-testid="upgrade-prompt-dialog-upgrade-button">Upgrade to Pro</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
