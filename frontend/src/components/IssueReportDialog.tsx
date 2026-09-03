import React from 'react';
import { Bug } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { deriveSessionIdFromPath } from '@/lib/sessionRoute';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/toast';
import {
  buildIssueReportMetadata,
  issueReportService,
  FEEDBACK_KINDS,
  FEEDBACK_KIND_LABELS,
  type FeedbackKind,
  type IssueReportCategory,
  type IssueReportSeverity,
} from '@/services/issueReportService';
import { resolvePageContext, issueAreasForContext, type PageContext } from '@/services/pageContext';
import { usePracticeSurface } from '@/components/practice/PracticeSurfaceContext';
import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';

interface IssueReportDialogProps {
  /** The submitter's account id (Option B): attached for authenticated reports so support can
   *  follow up. Opaque auth UUID — no email/name stored. Null only as a defensive fallback. */
  userId?: string | null;
  plan?: string | null;
  sttMode?: TranscriptionMode | null;
  runtimeState?: string | null;
}


// DB slug -> friendly, user-facing label. Labels are display-only; the DB stores the slug.
const CATEGORY_LABELS: Record<IssueReportCategory, string> = {
  recording_transcription: 'Recording / transcription',
  analytics_sessions: 'Analytics / saved sessions',
  billing_subscription: 'Billing / subscription',
  account_signin: 'Account / sign-in',
  privacy_data: 'Privacy / data',
  speed_performance: 'Speed / performance',
  something_else: 'Something else',
};
const CATEGORIES: IssueReportCategory[] = [
  'recording_transcription',
  'analytics_sessions',
  'billing_subscription',
  'account_signin',
  'privacy_data',
  'speed_performance',
  'something_else',
];
const SEVERITIES: IssueReportSeverity[] = ['medium', 'high', 'critical', 'low'];

export const IssueReportDialog: React.FC<IssueReportDialogProps> = ({
  userId,
  plan,
  sttMode,
  runtimeState,
}) => {
  const location = useLocation();
  // Active /practice surface (Quick/Objective/home) from the shared provider — null off /practice. Snapshotted
  // into pageContext at open time so the report is attributed to the surface the user was actually on.
  const { surface } = usePracticeSurface();
  const [open, setOpen] = React.useState(false);
  // Page identity + owned session id are SNAPSHOTTED when the dialog opens (see openContext), so a
  // route/journey transition while the dialog is open never changes the report's origin. This dialog
  // renders in global navigation, OUTSIDE the /analytics/:sessionId route element, so useParams() would
  // not see the sessionId — it is derived from the pathname (UUID-validated) at open time instead.
  const [pageContext, setPageContext] = React.useState<PageContext>(() => resolvePageContext(location.pathname, surface));
  const [snapshotSessionId, setSnapshotSessionId] = React.useState<string | null>(() => deriveSessionIdFromPath(location.pathname));
  const [issueArea, setIssueArea] = React.useState<string>(() => issueAreasForContext(resolvePageContext(location.pathname, surface))[0]?.value ?? 'other');
  // #1404 — the FIRST question, because it changes how the message is triaged. It starts UNSELECTED and
  // must be chosen: a pre-selected kind is a guess recorded as the user's answer, and "Issue" is the kind
  // that pulls support attention, so defaulting to it would manufacture defects out of compliments.
  const [feedbackKind, setFeedbackKind] = React.useState<FeedbackKind | ''>('');
  const [category, setCategory] = React.useState<IssueReportCategory>('recording_transcription');
  const [severity, setSeverity] = React.useState<IssueReportSeverity>('medium');
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  // #1306 metrics-only: there is NO transcript field on this form. A support report carries the user's own
  // typed title/description (+ optional audio-debug note) — never a transcript snippet or any session speech,
  // and nothing is ever pre-filled from a recording.
  const [includeAudio, setIncludeAudio] = React.useState(false);
  const [audioAttachmentNote, setAudioAttachmentNote] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const canSubmit = feedbackKind !== '' && title.trim().length >= 4 && description.trim().length >= 10 && !isSubmitting;

  const issueAreaOptions = issueAreasForContext(pageContext);

  // Snapshot the page context (incl. the active /practice surface) at dialog-OPEN time (not submit), then
  // defer to Radix's open state.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      const ctx = resolvePageContext(location.pathname, surface);
      setPageContext(ctx);
      setSnapshotSessionId(deriveSessionIdFromPath(location.pathname));
      setIssueArea(issueAreasForContext(ctx)[0]?.value ?? 'other');
      setFeedbackKind('');
    }
    setOpen(next);
  };

  const reset = () => {
    setFeedbackKind('');
    setCategory('recording_transcription');
    setSeverity('medium');
    setTitle('');
    setDescription('');
    setIncludeAudio(false);
    setAudioAttachmentNote('');
  };

  const submit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      // Store the sanitized route TEMPLATE — never the full URL, query string, or hash.
      const pageUrl = pageContext.canonicalRoute;
      const metadata = buildIssueReportMetadata({
        context: pageContext,
        issueArea,
        // `canSubmit` has already refused an empty kind; the cast documents that, and the builder
        // stores null rather than guessing if anything ever reaches it unset.
        feedbackKind: feedbackKind || null,
        plan,
        sttMode,
        runtimeState,
      });
      // Attach the submitter's account id for all authenticated reports so support can
      // follow up. The id is an opaque auth UUID — no email/name is stored in the row.
      await issueReportService.submit({
        userId: userId ?? null,
        sessionId: snapshotSessionId,
        category,
        severity,
        title,
        description,
        pageUrl,
        metadata,
        includeAudio,
        audioAttachmentNote: includeAudio ? audioAttachmentNote : null,
      });
      // Wording, not behaviour: confirming a Comment as an "Issue report" is simply untrue now.
      toast.success('Feedback submitted');
      reset();
      setOpen(false);
    } catch {
      toast.error('Feedback could not be submitted. Please try again or use the tester feedback link.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="inline-flex"
          data-testid="nav-report-issue-button"
          aria-label="Share Feedback"
        >
          <Bug className="h-4 w-4 md:mr-2" />
          <span className="hidden md:inline">Share Feedback</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Share Feedback</DialogTitle>
          <DialogDescription>
            Send the app state we need to debug. Transcript and audio details are optional and never included unless you choose them. Please don&apos;t include passwords or other sensitive personal information.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
            data-testid="issue-report-page-context"
          >
            <span className="text-muted-foreground">Reporting from:</span>
            <span className="font-medium text-foreground">{pageContext.pageLabel}</span>
          </div>

          <label className="space-y-1 text-sm font-medium">
            Message
            <select
              className="h-10 w-full rounded-md border border-input bg-muted/60 px-3 text-sm"
              value={feedbackKind}
              onChange={(event) => setFeedbackKind(event.target.value as FeedbackKind | '')}
              data-testid="issue-report-feedback-kind"
              required
            >
              <option value="" disabled>Choose Issue or Comment</option>
              {FEEDBACK_KINDS.map((k) => <option key={k} value={k}>{FEEDBACK_KIND_LABELS[k]}</option>)}
            </select>
          </label>

          <label className="space-y-1 text-sm font-medium">
            Where in the app?
            <select
              className="h-10 w-full rounded-md border border-input bg-muted/60 px-3 text-sm"
              value={issueArea}
              onChange={(event) => setIssueArea(event.target.value)}
              data-testid="issue-report-area"
            >
              {issueAreaOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">
              Category
              <select
                className="h-10 w-full rounded-md border border-input bg-muted/60 px-3 text-sm"
                value={category}
                onChange={(event) => setCategory(event.target.value as IssueReportCategory)}
                data-testid="issue-report-category"
              >
                {CATEGORIES.map((item) => <option key={item} value={item}>{CATEGORY_LABELS[item]}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Impact
              <select
                className="h-10 w-full rounded-md border border-input bg-muted/60 px-3 text-sm"
                value={severity}
                onChange={(event) => setSeverity(event.target.value as IssueReportSeverity)}
                data-testid="issue-report-severity"
              >
                {SEVERITIES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </div>

          <label className="space-y-1 text-sm font-medium">
            Title
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Example: Private mic did not start"
              maxLength={160}
              data-testid="issue-report-title"
            />
          </label>

          <label className="space-y-1 text-sm font-medium">
            Short description
            <textarea
              className="min-h-28 w-full rounded-md border border-input bg-muted/60 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What did you expect, what did the app do, and what were you trying to finish?"
              maxLength={5000}
              data-testid="issue-report-description"
            />
          </label>

          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground" data-testid="issue-report-disclosure">
            Linked to your account using an internal ID so support can investigate the issue. We include
            basic technical details to help debug. We do not include your email, name, password, login
            credentials, transcript, or audio unless you choose to add optional details.
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeAudio}
              onChange={(event) => setIncludeAudio(event.target.checked)}
              data-testid="issue-report-include-audio"
            />
            <span>Include an audio-debug note. Audio itself is not uploaded by this form.</span>
          </label>

          {includeAudio && (
            <label className="space-y-1 text-sm font-medium">
              Audio note
              <Input
                value={audioAttachmentNote}
                onChange={(event) => setAudioAttachmentNote(event.target.value)}
                placeholder="Example: I can provide the recording separately if needed"
                maxLength={500}
                data-testid="issue-report-audio-note"
              />
            </label>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => { void submit(); }} disabled={!canSubmit} data-testid="issue-report-submit">
            {isSubmitting ? 'Submitting...' : 'Submit report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
