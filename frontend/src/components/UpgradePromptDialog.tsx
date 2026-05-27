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
