import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getUpgradeUrl, trackConversionCtaClicked, trackConversionCtaViewed } from '@/services/conversionFunnel';
import { canShowFreePlanSupport, type FreePlanSupportPlacement, type FreePlanSupportTier } from '@/services/freePlanSupport';
import { arePaymentsEnabled } from '@/config/appRuntimeConfig';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

interface FreePlanSupportProps {
  tier: FreePlanSupportTier;
  placement: FreePlanSupportPlacement;
  isRecording?: boolean;
  isTrialPeriod?: boolean;
}

export function FreePlanSupport({ tier, placement, isRecording = false, isTrialPeriod = false }: FreePlanSupportProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const visible = canShowFreePlanSupport({
    tier,
    placement,
    route: location.pathname,
    isRecording,
    isTrialPeriod,
  });

  useEffect(() => {
    if (visible) {
      trackConversionCtaViewed({ source: 'free_plan_support', plan: 'pro' });
    }
  }, [visible]);

  if (!visible) return null;

  const handleUpgrade = () => {
    trackConversionCtaClicked({ source: 'free_plan_support', plan: 'pro' });
    navigate(getUpgradeUrl('free_plan_support', 'pro'));
  };

  return (
    <aside
      className="rounded-lg border border-border bg-card p-4 surface-shadow"
      data-testid={`free-plan-support-${placement}`}
      aria-label="Free plan support"
    >
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />
        Free plan support
      </div>
      <p className="text-sm font-semibold text-foreground">Free practice stays focused on your speaking work.</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Pro supports expanded limits and capacity when you need more room to practice.
      </p>
      {arePaymentsEnabled() && (
        <Button variant="outline" size="sm" className="mt-4" onClick={handleUpgrade}>
          Upgrade to Pro
        </Button>
      )}
    </aside>
  );
}
