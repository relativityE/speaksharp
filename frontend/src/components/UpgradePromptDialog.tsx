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
          <AlertDialogTitle>Keep practicing after your trial</AlertDialogTitle>
          <AlertDialogDescription>
            Your 30-day free trial includes the complete product — the same Open Mic, Focus Points, saved review, Progress, History, and PDF. Continue for $10/month to keep going after it ends. Private transcription stays on-device.
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
