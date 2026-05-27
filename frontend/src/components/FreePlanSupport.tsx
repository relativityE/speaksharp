import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getUpgradeUrl, trackConversionCtaClicked, trackConversionCtaViewed } from '@/services/conversionFunnel';
import { canShowFreePlanSupport, type FreePlanSupportPlacement, type FreePlanSupportTier } from '@/services/freePlanSupport';
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
      trackConversionCtaViewed({ source: 'free_plan_support', plan: 'basic' });
    }
  }, [visible]);

  if (!visible) return null;

  const handleUpgrade = () => {
    trackConversionCtaClicked({ source: 'free_plan_support', plan: 'basic' });
    navigate(getUpgradeUrl('free_plan_support', 'basic'));
  };

  return (
    <aside
      className="rounded-lg border border-border bg-card p-4 shadow-card"
      data-testid={`free-plan-support-${placement}`}
      aria-label="Free plan support"
    >
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />
        Free plan support
      </div>
      <p className="text-sm font-semibold text-foreground">Privacy-respecting sponsor messages help keep Free practice available.</p>
      <p className="mt-2 text-sm text-muted-foreground">
        We never use your transcript or speaking data for ads. Paid Basic and Pro are ad-free.
      </p>
      <Button variant="outline" size="sm" className="mt-4" onClick={handleUpgrade}>
        Go ad-free with Basic
      </Button>
    </aside>
  );
}
