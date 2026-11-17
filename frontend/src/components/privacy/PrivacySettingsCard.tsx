/**
 * #1835 — Account → Privacy & data (design spec 2026-11-13, S6 and S7; PO-approved policy 17 Nov).
 *
 * Two switches for FUTURE use. A switch never deletes anything already saved, and there are no delete controls here
 * (out of scope for #1835). AI coaching needs saving in v1: with saving off the AI switch is off and unavailable, and
 * turning saving off asks first (S7) because it turns AI coaching off too. A turn-off takes effect in this client at once.
 */
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { savePracticePrivacy, transcriptSaveAllowed, coachingAllowed, usePracticePrivacyStore,
  type PracticePrivacyState } from '@/services/practicePrivacy';
import { PRIVACY_SETTINGS_COPY } from './privacyCopy';


export const PrivacySettingsCard: React.FC = () => {
  const privacy = usePracticePrivacyStore();
  const [confirmStop, setConfirmStop] = useState<PracticePrivacyState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'failed' | 'changed' | null>(null);
  const loading = privacy.status === 'loading' || privacy.status === 'signed_out';
  const saveOn = transcriptSaveAllowed(privacy);
  const aiOn = coachingAllowed(privacy);
  const controlsDisabled = loading || privacy.status === 'unavailable' || busy;

  const record = async (save: boolean, ai: boolean, basis: PracticePrivacyState) => {
    setBusy(true);
    setError(null);
    const result = await savePracticePrivacy(save, save && ai, basis);
    setBusy(false);
    if (!result.ok) setError(result.reason === 'changed' ? 'changed' : 'failed');
  };

  const onSaveChange = (next: boolean) => {
    if (next) void record(true, aiOn, privacy);
    else setConfirmStop(privacy);
  };

  return (
    <Card id="privacy-data" data-testid="privacy-settings" data-status={privacy.status}>
      <CardHeader>
        <CardTitle>Privacy &amp; data</CardTitle>
        <CardDescription>{PRIVACY_SETTINGS_COPY.lead}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-0">
        {loading && <p role="status" className="pb-4 text-sm text-muted-foreground">{PRIVACY_SETTINGS_COPY.loading}</p>}
        {privacy.status === 'unavailable' && <p role="alert" className="pb-4 text-sm">{PRIVACY_SETTINGS_COPY.unavailable}</p>}
        {privacy.status === 'unknown' && <p className="pb-4 text-sm text-muted-foreground" data-testid="privacy-settings-unknown">{PRIVACY_SETTINGS_COPY.unknown}</p>}

        <div className="flex items-start justify-between gap-4 border-b border-neutral-border-soft py-4">
          <div>
            <label htmlFor="privacy-save-switch" className="text-[16px] font-bold text-neutral-heading">Save transcripts</label>
            <p className="mt-0.5 text-[14px] text-neutral-secondary">{saveOn ? PRIVACY_SETTINGS_COPY.saveOn : PRIVACY_SETTINGS_COPY.saveOff}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[13px] font-bold" aria-hidden="true">{saveOn ? 'On' : 'Off'}</span>
            <Switch id="privacy-save-switch" checked={saveOn} disabled={controlsDisabled} onCheckedChange={onSaveChange}
              data-testid="privacy-save-switch" />
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 border-b border-neutral-border-soft py-4">
          <div>
            <label htmlFor="privacy-ai-switch" className="text-[16px] font-bold text-neutral-heading">AI coaching</label>
            <p className="mt-0.5 text-[14px] text-neutral-secondary" data-testid="privacy-ai-description">
              {saveOn ? <>{PRIVACY_SETTINGS_COPY.ai}{' '}
                <a href="/privacy#service-providers" className="font-semibold underline underline-offset-2">Who provides it</a></>
                : PRIVACY_SETTINGS_COPY.aiNeedsSave}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[13px] font-bold" aria-hidden="true">{aiOn ? 'On' : 'Off'}</span>
            <Switch id="privacy-ai-switch" checked={aiOn} disabled={controlsDisabled || !saveOn}
              onCheckedChange={(next) => { void record(true, next, privacy); }} data-testid="privacy-ai-switch" />
          </div>
        </div>

        <p className="pt-4 text-[14px] text-neutral-secondary">{PRIVACY_SETTINGS_COPY.note}</p>
        {error && <p role="alert" className="pt-2 text-sm text-destructive" data-testid="privacy-settings-error">
          {error === 'changed' ? PRIVACY_SETTINGS_COPY.changed : PRIVACY_SETTINGS_COPY.failed}
        </p>}
      </CardContent>

      <AlertDialog open={confirmStop !== null} onOpenChange={(open) => { if (!open) setConfirmStop(null); }}>
        <AlertDialogContent data-testid="privacy-stop-saving-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{PRIVACY_SETTINGS_COPY.stopTitle}</AlertDialogTitle>
            <AlertDialogDescription>{PRIVACY_SETTINGS_COPY.stopBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="privacy-stop-saving-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="privacy-stop-saving-confirm" onClick={() => {
              if (confirmStop) void record(false, false, confirmStop);
            }}>
              Stop saving
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default PrivacySettingsCard;
