/**
 * #1835 — the two-choice card shown on Practice while the signed-in owner has no recorded privacy choice (design spec
 * 2026-11-13, S1 for a new user and S2 for an existing one; PO-approved policy 17 Nov).
 *
 * Nothing is preselected. AI coaching needs saving in v1, so "Don't save" makes both AI options unavailable with the
 * stated reason. Continue records both answers through the one atomic RPC; until then the owner's choice stays unknown,
 * which every surface treats as off: no transcript text is saved and no coaching is requested.
 */
import React, { useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { savePracticePrivacy, usePracticePrivacyStore } from '@/services/practicePrivacy';
import { PRIVACY_PROMPT_COPY } from './privacyCopy';


interface OptionProps {
  testId: string;
  title: string;
  consequence: string;
  selected: boolean;
  unavailable?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

const Option: React.FC<OptionProps> = ({ testId, title, consequence, selected, unavailable = false, disabled = false, onSelect }) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    disabled={disabled}
    aria-disabled={unavailable || undefined}
    onClick={() => { if (!unavailable) onSelect(); }}
    data-testid={testId}
    data-selected={selected ? 'true' : 'false'}
    className={[
      'flex min-h-[66px] flex-1 flex-col items-start rounded-[10px] px-3.5 py-3 text-left',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      selected ? 'border-2 border-signature-text bg-signature-ground'
        : unavailable ? 'border-[1.5px] border-dashed border-neutral-border-strong'
          : 'border-[1.5px] border-neutral-border-strong',
    ].join(' ')}
  >
    <span className={`inline-flex items-center gap-1.5 text-[15px] font-extrabold ${unavailable ? 'text-neutral-muted' : 'text-neutral-heading'}`}>
      {selected && <Check className="h-4 w-4 text-signature-text" aria-hidden="true" />}
      {title}
    </span>
    <span className="mt-0.5 text-[13px] font-medium text-neutral-secondary">{consequence}</span>
  </button>
);

interface PracticePrivacyPromptProps {
  /** The owner already has saved practice (S2 copy): their past data is left as it is. */
  returning: boolean;
}

export const PracticePrivacyPrompt: React.FC<PracticePrivacyPromptProps> = ({ returning }) => {
  const privacy = usePracticePrivacyStore();
  const [save, setSave] = useState<boolean | null>(null);
  const [ai, setAi] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  // Guard events in the same batch, before React publishes the disabled controls.
  const submissionPending = useRef(false);
  const [error, setError] = useState<'failed' | 'changed' | null>(null);
  const aiUnavailable = save === false;
  // A "Don't save" answer settles the AI question too (it can only be off).
  const aiAnswer = aiUnavailable ? false : ai;
  const ready = save !== null && aiAnswer !== null;

  const chooseSave = (value: boolean) => {
    if (submissionPending.current) return;
    setSave(value);
    setError(null);
    if (!value) setAi(null);
  };
  const chooseAi = (value: boolean) => {
    if (submissionPending.current) return;
    setAi(value);
    setError(null);
  };
  const submit = async () => {
    if (!ready || submissionPending.current || save === null || aiAnswer === null) return;
    submissionPending.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await savePracticePrivacy(save, save && aiAnswer, privacy);
      if (!result.ok) setError(result.reason === 'changed' ? 'changed' : 'failed');
    } catch {
      setError('failed');
    } finally {
      submissionPending.current = false;
      setSaving(false);
    }
  };

  return (
    <Card className="mb-6" data-testid="practice-privacy-prompt" data-variant={returning ? 'returning' : 'new'}>
      <CardHeader>
        <CardTitle className="text-[21px] font-extrabold">
          {returning ? PRIVACY_PROMPT_COPY.returningTitle : PRIVACY_PROMPT_COPY.newTitle}
        </CardTitle>
        <CardDescription className="text-[15px]">
          {returning ? PRIVACY_PROMPT_COPY.returningIntro : PRIVACY_PROMPT_COPY.newIntro}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <fieldset className="border-t border-neutral-border-soft pt-5">
          <legend className="sr-only">{PRIVACY_PROMPT_COPY.saveLegend}</legend>
          <p className="text-[16px] font-extrabold text-neutral-heading" aria-hidden="true">{PRIVACY_PROMPT_COPY.saveLegend}</p>
          <p className="mt-1 text-[14px] font-medium leading-normal text-neutral-secondary">{PRIVACY_PROMPT_COPY.saveHelp}</p>
          <div className="mt-3 flex gap-2.5" role="radiogroup" aria-label={PRIVACY_PROMPT_COPY.saveLegend}>
            <Option testId="privacy-save-yes" title="Save transcripts" consequence="Reread it and download a report later."
              selected={save === true} disabled={saving} onSelect={() => chooseSave(true)} />
            <Option testId="privacy-save-no" title="Don't save" consequence="See it now. It's gone when you leave."
              selected={save === false} disabled={saving} onSelect={() => chooseSave(false)} />
          </div>
        </fieldset>

        <fieldset className="border-t border-neutral-border-soft pt-5">
          <legend className="sr-only">{PRIVACY_PROMPT_COPY.aiLegend}</legend>
          <p className="text-[16px] font-extrabold text-neutral-heading" aria-hidden="true">{PRIVACY_PROMPT_COPY.aiLegend}</p>
          <p className="mt-1 text-[14px] font-medium leading-normal text-neutral-secondary">
            {PRIVACY_PROMPT_COPY.aiHelp}{' '}
            <a href="/privacy#service-providers" className="font-bold underline underline-offset-2">Who provides it</a>
          </p>
          <div className="mt-3 flex gap-2.5" role="radiogroup" aria-label={PRIVACY_PROMPT_COPY.aiLegend}>
            <Option testId="privacy-ai-yes" title="Get AI coaching" consequence="A written review after each session."
              selected={!aiUnavailable && ai === true} unavailable={aiUnavailable} disabled={saving} onSelect={() => chooseAi(true)} />
            <Option testId="privacy-ai-no" title="No coaching" consequence="Measured results only. Nothing goes to the AI service."
              selected={!aiUnavailable && ai === false} unavailable={aiUnavailable} disabled={saving} onSelect={() => chooseAi(false)} />
          </div>
          {aiUnavailable && (
            <p className="mt-3 rounded-lg border border-neutral-border-soft bg-neutral-band px-3 py-2.5 text-[14px] font-semibold text-neutral-body"
              data-testid="privacy-ai-needs-save">
              {PRIVACY_PROMPT_COPY.aiNeedsSave}
            </p>
          )}
        </fieldset>

        <div className="flex flex-col gap-3 border-t border-neutral-border-soft pt-5 sm:flex-row sm:items-start sm:justify-between">
          <p className="text-[13px] text-neutral-secondary">
            {returning ? PRIVACY_PROMPT_COPY.returningFooter : PRIVACY_PROMPT_COPY.newFooter}
          </p>
          <div className="flex flex-col items-start sm:items-end">
            <button
              type="button"
              onClick={() => { void submit(); }}
              disabled={!ready || saving}
              aria-busy={saving || undefined}
              data-testid="privacy-continue"
              className="min-h-[46px] rounded-[10px] bg-ink px-[26px] text-[16px] font-extrabold text-ink-text disabled:bg-neutral-border-soft disabled:text-neutral-secondary"
            >
              Continue
            </button>
            {!ready && (
              <p className="mt-1.5 text-[12px] font-semibold text-neutral-secondary" data-testid="privacy-continue-reason">
                {PRIVACY_PROMPT_COPY.continueReason}
              </p>
            )}
          </div>
        </div>
        {error && (
          <p role="alert" className="text-[14px] font-semibold text-state-error" data-testid="privacy-save-error">
            {error === 'changed' ? PRIVACY_PROMPT_COPY.changed : PRIVACY_PROMPT_COPY.saveFailed}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default PracticePrivacyPrompt;
