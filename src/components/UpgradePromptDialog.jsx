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

export function UpgradePromptDialog({ open, onOpenChange }) {

  const handleUpgrade = async () => {
    try {
        const { data, error } = await supabase.functions.invoke('stripe-checkout');
        if (error) throw error;
        // The edge function returns a URL to the Stripe checkout page
        window.location.href = data.checkoutUrl;
    } catch (error) {
        console.error('Error creating Stripe checkout session:', error);
        // You might want to show an error message to the user here
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>You've Reached Your Free Limit</AlertDialogTitle>
          <AlertDialogDescription>
            You've used all your free practice time for this month. Please upgrade to the Pro plan to continue practicing without limits and unlock all features.
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
