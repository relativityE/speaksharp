import React from 'react';
import { Bug } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { deriveSessionIdFromPath } from '@/lib/sessionRoute';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from '@/lib/toast';
import {
  buildIssueReportMetadata,
  issueReportService,
  COMMENT_SEVERITY,
  type FeedbackKind,
  type FeedbackType,
  type IssueReportCategory,
  type IssueReportSeverity,
} from '@/services/issueReportService';
import { resolvePageContext, issueAreasForContext, type PageContext } from '@/services/pageContext';
import { usePracticeSurface } from '@/components/practice/PracticeSurfaceContext';
import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';

interface IssueReportDialogProps {
  userId?: string | null;
  plan?: string | null;
  sttMode?: TranscriptionMode | null;
  runtimeState?: string | null;
}

type FeedbackSeverity = 'minor' | 'slowed' | 'blocked';

interface FeedbackDraft {
  type: FeedbackType | null;
  body: string;
  severity: FeedbackSeverity | null;
  savedAt: number;
  idempotencyKey: string;
}

const DRAFT_KEY = 'feedback.draft';
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const TYPE_OPTIONS: Array<{ value: FeedbackType; label: string; selectedClass: string }> = [
  { value: 'broke', label: 'Something broke', selectedClass: 'border-[#d98a1f] bg-[#fdf3e2]' },
  { value: 'confused', label: 'Something confused me', selectedClass: 'border-[#d98a1f] bg-[#fdf3e2]' },
  { value: 'idea', label: 'I have an idea', selectedClass: 'border-[#6d28d9] bg-[#f5f0ff]' },
  { value: 'praise', label: 'This worked well', selectedClass: 'border-[#0d7d74] bg-[#eaf5f3]' },
];

const BODY_COPY: Record<FeedbackType, { label: string; placeholder: string; helper: string }> = {
  broke: { label: 'What happened?', placeholder: 'What you did, and what happened instead.', helper: 'Steps, or what you expected instead — whatever you have.' },
  confused: { label: 'What was confusing?', placeholder: 'The part that didn’t read clearly.', helper: 'Where you got stuck is enough.' },
  idea: { label: 'What would you add?', placeholder: 'The thing you wish it did.', helper: 'Rough is fine.' },
  praise: { label: 'What worked?', placeholder: 'The part that landed for you.', helper: 'A sentence is plenty.' },
};

const SEVERITY_OPTIONS: Array<{ value: FeedbackSeverity; label: string }> = [
  { value: 'minor', label: 'Not really' },
  { value: 'slowed', label: 'Slowed me down' },
  { value: 'blocked', label: 'Couldn’t finish' },
];

const makeIdempotencyKey = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const tail = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 12).padEnd(12, '0');
  return `00000000-0000-4000-8000-${tail}`;
};

const readDraft = (): FeedbackDraft | null => {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<FeedbackDraft>;
    if (typeof value.savedAt !== 'number' || Date.now() - value.savedAt > DRAFT_MAX_AGE_MS) {
      sessionStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return {
      type: TYPE_OPTIONS.some((item) => item.value === value.type) ? value.type as FeedbackType : null,
      body: typeof value.body === 'string' ? value.body : '',
      severity: SEVERITY_OPTIONS.some((item) => item.value === value.severity) ? value.severity as FeedbackSeverity : null,
      savedAt: value.savedAt,
      idempotencyKey: typeof value.idempotencyKey === 'string' && value.idempotencyKey !== '' ? value.idempotencyKey : makeIdempotencyKey(),
    };
  } catch {
    return null;
  }
};

const clearDraft = () => {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage is optional */ }
};

const deriveCategory = (context: PageContext): IssueReportCategory => {
  if (context.pageKey === 'session') return 'recording_transcription';
  if (context.pageKey === 'analytics' || context.pageKey === 'analytics_session') return 'analytics_sessions';
  if (context.pageKey === 'auth') return 'account_signin';
  if (context.pageKey === 'pricing') return 'billing_subscription';
  return 'something_else';
};

const deriveTitle = (body: string): string => {
  const trimmed = body.trim();
  const sentence = trimmed.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? trimmed;
  return sentence.slice(0, 80).trim();
};

const mapSeverity = (type: FeedbackType, severity: FeedbackSeverity | null): IssueReportSeverity | typeof COMMENT_SEVERITY => {
  if (type !== 'broke' || severity == null) return COMMENT_SEVERITY;
  if (severity === 'minor') return 'low';
  if (severity === 'slowed') return 'medium';
  return 'high';
};

export const IssueReportDialog: React.FC<IssueReportDialogProps> = ({ userId, plan, sttMode, runtimeState }) => {
  const location = useLocation();
  const { surface } = usePracticeSurface();
  const [open, setOpen] = React.useState(false);
  const [pageContext, setPageContext] = React.useState<PageContext>(() => resolvePageContext(location.pathname, surface));
  const [snapshotSessionId, setSnapshotSessionId] = React.useState<string | null>(() => deriveSessionIdFromPath(location.pathname));
  const [type, setType] = React.useState<FeedbackType | null>(null);
  const [body, setBody] = React.useState('');
  const [severity, setSeverity] = React.useState<FeedbackSeverity | null>(null);
  const [idempotencyKey, setIdempotencyKey] = React.useState(makeIdempotencyKey);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showDisclosure, setShowDisclosure] = React.useState(false);
  const typeRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const bodyCopy = type ? BODY_COPY[type] : null;
  const canSubmit = type !== null && body.trim().length > 0 && !isSubmitting;

  React.useEffect(() => {
    if (!open || (type === null && body === '' && severity === null)) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ type, body, severity, savedAt: Date.now(), idempotencyKey }));
    } catch { /* draft persistence degrades safely */ }
  }, [body, idempotencyKey, open, severity, type]);

  React.useEffect(() => {
    if (userId == null) clearDraft();
  }, [userId]);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      const context = resolvePageContext(location.pathname, surface);
      const draft = readDraft();
      setPageContext(context);
      setSnapshotSessionId(deriveSessionIdFromPath(location.pathname));
      setType(draft?.type ?? null);
      setBody(draft?.body ?? '');
      setSeverity(draft?.severity ?? null);
      setIdempotencyKey(draft?.idempotencyKey ?? makeIdempotencyKey());
      setError(null);
      setShowDisclosure(false);
    }
    setOpen(next);
  };

  const cancel = () => {
    clearDraft();
    setType(null);
    setBody('');
    setSeverity(null);
    setIdempotencyKey(makeIdempotencyKey());
    setOpen(false);
  };

  const selectType = (next: FeedbackType) => {
    setType(next);
    if (next !== 'broke') setSeverity(null);
  };

  const handleTypeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const nextIndex = (index + delta + TYPE_OPTIONS.length) % TYPE_OPTIONS.length;
    selectType(TYPE_OPTIONS[nextIndex].value);
    typeRefs.current[nextIndex]?.focus();
  };

  const submit = async () => {
    if (!canSubmit || type == null) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const feedbackKind: FeedbackKind = type === 'broke' ? 'issue' : 'comment';
      const issueArea = issueAreasForContext(pageContext)[0]?.value ?? null;
      await issueReportService.submit({
        userId: userId ?? null,
        sessionId: snapshotSessionId,
        category: deriveCategory(pageContext),
        severity: mapSeverity(type, severity),
        title: deriveTitle(body),
        description: body,
        pageUrl: pageContext.canonicalRoute,
        metadata: buildIssueReportMetadata({ context: pageContext, issueArea, feedbackKind, feedbackType: type, feedbackSeverity: severity, plan, sttMode, runtimeState }),
        includeAudio: false,
        audioAttachmentNote: null,
        idempotencyKey,
      });
      clearDraft();
      setType(null);
      setBody('');
      setSeverity(null);
      setIdempotencyKey(makeIdempotencyKey());
      setOpen(false);
      toast.success('Thanks — we’ve got it.');
    } catch {
      setError('That didn’t go through. Try again?');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="inline-flex" data-testid="nav-report-issue-button" aria-label="Share Feedback">
          <Bug className="h-4 w-4 md:mr-2" aria-hidden="true" />
          <span className="hidden md:inline">Share Feedback</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[88vh] overflow-y-auto sm:max-w-xl"
        onOpenAutoFocus={(event) => { event.preventDefault(); typeRefs.current[0]?.focus(); }}
      >
        <DialogHeader><DialogTitle>Share feedback</DialogTitle></DialogHeader>

        <div className="space-y-5">
          <div>
            <div id="feedback-type-label" className="mb-2 text-sm font-extrabold">What would you like to share?</div>
            <div role="radiogroup" aria-labelledby="feedback-type-label" data-testid="issue-report-feedback-kind" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {TYPE_OPTIONS.map((option, index) => {
                const selected = type === option.value;
                return (
                  <button
                    key={option.value}
                    ref={(element) => { typeRefs.current[index] = element; }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`feedback-type-${option.value}`}
                    onClick={() => selectType(option.value)}
                    onKeyDown={(event) => handleTypeKeyDown(event, index)}
                    className={`min-h-12 rounded-xl border p-3 text-left text-sm font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${selected ? `border-2 ${option.selectedClass}` : 'border-[#dbe2ec] bg-white'}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block space-y-2 text-sm font-extrabold">
            {bodyCopy?.label ?? 'What would you like us to know?'}
            <textarea
              className="min-h-[118px] w-full resize-y rounded-xl border border-[#e6ebf2] bg-[#f7f9fc] px-4 py-3 text-sm font-normal ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={bodyCopy?.placeholder}
              maxLength={5000}
              data-testid="issue-report-description"
            />
            {bodyCopy?.helper && <span className="block text-xs font-semibold text-[#8b95a5]">{bodyCopy.helper}</span>}
          </label>

          {type === 'broke' && (
            <div aria-live="polite">
              <div id="feedback-severity-label" className="mb-2 text-sm font-extrabold">Did it stop you?</div>
              <div role="radiogroup" aria-labelledby="feedback-severity-label" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {SEVERITY_OPTIONS.map((option) => {
                  const selected = severity === option.value;
                  return (
                    <button key={option.value} type="button" role="radio" aria-checked={selected} data-testid={`feedback-severity-${option.value}`} onClick={() => setSeverity(option.value)} className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${selected ? 'border-2 border-[#d98a1f] bg-[#fdf3e2]' : 'border-[#dbe2ec] bg-white'}`}>
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}

          <div className="border-t border-[#eef1f6] pt-4 text-xs font-semibold text-[#8b95a5]" data-testid="issue-report-page-context">
            Sent from <strong className="font-extrabold text-[#414b5c]">{pageContext.pageLabel}</strong> · no transcript or audio.{' '}
            <button type="button" onClick={() => setShowDisclosure((value) => !value)} className="font-bold underline underline-offset-2">What&apos;s included</button>
            {showDisclosure && (
              <p className="mt-2 leading-relaxed" data-testid="issue-report-disclosure">
                An internal account reference for follow-up, this screen, the app version, and basic browser and operating-system details. Never your email, name, credentials, transcript, or audio.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="ghost" onClick={cancel}>Cancel</Button>
          <Button type="button" onClick={() => { void submit(); }} disabled={!canSubmit} data-testid="issue-report-submit">
            {isSubmitting ? 'Sending…' : 'Send'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
