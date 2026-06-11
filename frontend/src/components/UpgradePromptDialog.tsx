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
import { useNavigate } from 'react-router-dom';
import { getUpgradeUrl, trackConversionCtaClicked, trackConversionCtaViewed } from '@/services/conversionFunnel';
import { arePaymentsEnabled } from '@/config/appRuntimeConfig';
import { useEffect } from 'react';

interface UpgradePromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const UpgradePromptDialog: React.FC<UpgradePromptDialogProps> = ({ open, onOpenChange }) => {
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      trackConversionCtaViewed({ source: 'post_session_prompt', plan: 'pro' });
    }
  }, [open]);

  const handleUpgrade = () => {
    trackConversionCtaClicked({ source: 'post_session_prompt', plan: 'pro' });
    onOpenChange(false);
    navigate(getUpgradeUrl('post_session_prompt', 'pro'));
  };

  // Payments not configured: the post-session upgrade prompt is purely a payment
  // CTA, so suppress it entirely rather than show a dead "Upgrade to Pro" button.
  if (!arePaymentsEnabled()) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Keep your full practice history</AlertDialogTitle>
          <AlertDialogDescription>
            Upgrade to Pro for full session history, Private local transcription, deeper practice reports, and billing support during paid early access.
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
