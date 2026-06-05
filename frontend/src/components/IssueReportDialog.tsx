import React from 'react';
import { Bug } from 'lucide-react';
import { useLocation, useParams } from 'react-router-dom';
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
  type IssueReportCategory,
  type IssueReportSeverity,
} from '@/services/issueReportService';
import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';

interface IssueReportDialogProps {
  userId: string;
  plan?: string | null;
  sttMode?: TranscriptionMode | null;
  runtimeState?: string | null;
  transcript?: string;
}

const CATEGORIES: IssueReportCategory[] = ['stt', 'analytics', 'billing', 'account', 'privacy', 'performance', 'general'];
const SEVERITIES: IssueReportSeverity[] = ['medium', 'high', 'critical', 'low'];

export const IssueReportDialog: React.FC<IssueReportDialogProps> = ({
  userId,
  plan,
  sttMode,
  runtimeState,
  transcript = '',
}) => {
  const location = useLocation();
  const params = useParams();
  const [open, setOpen] = React.useState(false);
  const [category, setCategory] = React.useState<IssueReportCategory>('stt');
  const [severity, setSeverity] = React.useState<IssueReportSeverity>('medium');
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [includeTranscript, setIncludeTranscript] = React.useState(false);
  const [includeAudio, setIncludeAudio] = React.useState(false);
  const [audioAttachmentNote, setAudioAttachmentNote] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const currentTranscript = transcript.trim();
  const canSubmit = title.trim().length >= 4 && description.trim().length >= 10 && !isSubmitting;

  const reset = () => {
    setCategory('stt');
    setSeverity('medium');
    setTitle('');
    setDescription('');
    setIncludeTranscript(false);
    setIncludeAudio(false);
    setAudioAttachmentNote('');
  };

  const submit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const pageUrl = typeof window !== 'undefined' ? window.location.href : location.pathname;
      const metadata = buildIssueReportMetadata({
        route: `${location.pathname}${location.search}`,
        plan,
        sttMode,
        runtimeState,
      });
      await issueReportService.submit({
        userId,
        sessionId: params.sessionId ?? null,
        category,
        severity,
        title,
        description,
        pageUrl,
        metadata,
        includeTranscript,
        transcriptExcerpt: includeTranscript ? currentTranscript.slice(0, 4000) : null,
        includeAudio,
        audioAttachmentNote: includeAudio ? audioAttachmentNote : null,
      });
      toast.success('Issue report submitted');
      reset();
      setOpen(false);
    } catch {
      toast.error('Issue report could not be submitted. Please try again or use the tester feedback link.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="hidden md:inline-flex"
          data-testid="nav-report-issue-button"
        >
          <Bug className="h-4 w-4 mr-2" />
          Report issue
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Report an issue</DialogTitle>
          <DialogDescription>
            Send the app state we need to debug. Transcript and audio details are optional and never included unless you choose them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">
              Category
              <select
                className="h-10 w-full rounded-md border border-input bg-muted/60 px-3 text-sm"
                value={category}
                onChange={(event) => setCategory(event.target.value as IssueReportCategory)}
                data-testid="issue-report-category"
              >
                {CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
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
            Short title
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Example: Private mic did not start"
              maxLength={160}
              data-testid="issue-report-title"
            />
          </label>

          <label className="space-y-1 text-sm font-medium">
            What happened?
            <textarea
              className="min-h-28 w-full rounded-md border border-input bg-muted/60 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What did you expect, what did the app do, and what were you trying to finish?"
              maxLength={5000}
              data-testid="issue-report-description"
            />
          </label>

          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            Automatically included: URL, route, browser, viewport, timezone, release-proof config, plan, STT mode, and last Sentry event id when available.
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeTranscript}
              onChange={(event) => setIncludeTranscript(event.target.checked)}
              data-testid="issue-report-include-transcript"
            />
            <span>
              Include the current transcript excerpt
              {currentTranscript ? ` (${Math.min(currentTranscript.length, 4000)} chars)` : ' (none available)'}
            </span>
          </label>

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
