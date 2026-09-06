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
import { resolvePageContext, type PageContext } from '@/services/pageContext';
import {
  clearFeedbackDraft,
  isEmptyFeedbackDraft,
  readFeedbackDraft,
  writeFeedbackDraft,
  type FeedbackSeverity,
} from '@/services/feedbackDraft';
import { usePracticeSurface } from '@/components/practice/PracticeSurfaceContext';
import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';

interface IssueReportDialogProps {
  userId?: string | null;
  plan?: string | null;
  sttMode?: TranscriptionMode | null;
  runtimeState?: string | null;
}

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

const deriveCategory = (context: PageContext): IssueReportCategory => {
  if (context.pageKey === 'session') return 'recording_transcription';
  if (context.pageKey === 'analytics' || context.pageKey === 'analytics_session') return 'analytics_sessions';
  if (context.pageKey === 'auth') return 'account_signin';
  if (context.pageKey === 'pricing') return 'billing_subscription';
  return 'something_else';
};

/**
 * The database stores `title` under `length(btrim(title)) BETWEEN 1 AND 80`. Postgres `length()`
 * counts CHARACTERS (code points); JavaScript's `slice` counts UTF-16 code units. Those disagree for
 * anything outside the BMP.
 *
 * #1416 — `slice(0, 80)` on 79 ASCII characters followed by an emoji keeps the emoji's HIGH surrogate
 * and drops its low one. The result is a lone surrogate, which is not a valid Unicode scalar and has
 * no UTF-8 encoding: serializing it yields either a replacement character or bytes the server
 * rejects. The user's report is lost at the boundary, after they were told it was sent, and the
 * trigger is one emoji at one position — so it would never show up in ordinary use.
 *
 * Segmenting by grapheme keeps combining marks, flags and ZWJ sequences whole, so a title never ends
 * mid-character to a reader either. The budget is still counted in CODE POINTS, because that is what
 * the constraint counts: one family emoji is a single grapheme but several code points, and
 * truncating to 80 graphemes could exceed the column.
 */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const getReducedMotion = (): boolean => (
  typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_MOTION_QUERY).matches
);

/** No motion preference exists before hydration; assume the animated default and correct on mount. */
const getReducedMotionServer = (): boolean => false;

const subscribeReducedMotion = (onChange: () => void): (() => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => { /* no media support */ };
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }
  // Safari before 14 only has the deprecated listener API.
  query.addListener(onChange);
  return () => query.removeListener(onChange);
};

/** The approved reveal duration for the conditional severity row. */
export const SEVERITY_REVEAL_MS = 160;

const MAX_TITLE_CODE_POINTS = 80;

const truncateToCodePoints = (value: string, max: number): string => {
  // Not from lib typings: `Intl.Segmenter` needs a newer lib target than this project compiles with.
  const segmenterCtor = (Intl as unknown as {
    Segmenter?: new (locales?: string | string[], options?: { granularity: string })
      => { segment(input: string): Iterable<{ segment: string }> };
  }).Segmenter;

  // `Array.from` on a string iterates CODE POINTS, so even the fallback cannot split a surrogate pair.
  const units: string[] = segmenterCtor
    ? Array.from(new segmenterCtor(undefined, { granularity: 'grapheme' }).segment(value), (s) => s.segment)
    : Array.from(value);

  let out = '';
  let codePoints = 0;
  for (const unit of units) {
    const size = Array.from(unit).length;
    if (codePoints + size > max) {
      // #1416 — A WHOLE GRAPHEME IS PREFERRED, NOT GUARANTEED.
      //
      // Keeping only whole clusters silently assumes every cluster fits. A single cluster can be
      // arbitrarily long — a ZWJ sequence, or text with many combining marks — so a body that opens
      // with one produces an EMPTY title, and `length(btrim(title)) BETWEEN 1 AND 80` rejects the
      // insert. The user is told their report was sent and it never lands, and the trigger is the
      // first character they typed.
      //
      // So when nothing has been kept yet, the oversized unit is cut by CODE POINT to fill the
      // budget. That can split a cluster — a combining mark may be separated from its base — but it
      // cannot split a surrogate pair, so the result is still valid Unicode and still submittable.
      // A slightly malformed title beats a report that silently disappears.
      if (out === '') out = Array.from(unit).slice(0, max).join('');
      break;
    }
    out += unit;
    codePoints += size;
  }
  return out;
};

const deriveTitle = (body: string): string => {
  const trimmed = body.trim();
  const sentence = trimmed.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? trimmed;
  return truncateToCodePoints(sentence, MAX_TITLE_CODE_POINTS).trim();
};

/**
 * #1416 — a `role="radio"` group must behave like a native one, or it is only dressed as one.
 *
 * Both groups here are plain buttons. A native radio group is ONE tab stop: Tab enters it, arrows
 * move between options (selecting as they go, and wrapping), and Tab leaves for the next control.
 * Without a roving `tabIndex` every option is its own tab stop, so a keyboard user tabs through four
 * type buttons and three severity buttons to reach the message field — while a screen reader,
 * reading the ARIA roles, tells them arrows should have done it.
 *
 * `moveRadioFocus` returns the next index for an arrow key, or null when the key is not one this
 * group handles — so unrelated keys (Tab included) are never intercepted.
 */
const ARROW_BACK = ['ArrowLeft', 'ArrowUp'];
const ARROW_FORWARD = ['ArrowRight', 'ArrowDown'];

const moveRadioFocus = (key: string, index: number, count: number): number | null => {
  const delta = ARROW_BACK.includes(key) ? -1 : ARROW_FORWARD.includes(key) ? 1 : null;
  if (delta === null) return null;
  return (index + delta + count) % count;
};

/**
 * Which option carries `tabIndex={0}`. The selected one, or the first when nothing is selected yet —
 * the same rule a native group follows, so Tab lands where the user left off rather than at the top.
 */
const isRadioTabStop = (index: number, selectedIndex: number): boolean =>
  selectedIndex === -1 ? index === 0 : index === selectedIndex;

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
  const [attempted, setAttempted] = React.useState<{ key: string; signature: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showDisclosure, setShowDisclosure] = React.useState(false);
  const typeRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const severityRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const draftOwnerRef = React.useRef<string | null>(userId ?? null);

  // #1416 — the reveal follows the CURRENT motion preference, not the one that happened to be set
  // when this component mounted. Reading it once looks harmless because a dialog is short lived, but
  // the dialog lives inside `Navigation`, which is mounted for the whole session: someone who turns
  // reduce-motion on — in OS settings, or because a vestibular symptom just started — would keep
  // getting animation until they reloaded the page. Subscribing costs one listener and removes the
  // reload.
  const prefersReducedMotion = React.useSyncExternalStore(
    subscribeReducedMotion, getReducedMotion, getReducedMotionServer,
  );
  const revealMs = prefersReducedMotion ? 0 : SEVERITY_REVEAL_MS;
  const severityRevealed = type === 'broke';
  const severityIndex = SEVERITY_OPTIONS.findIndex((option) => option.value === severity);
  const typeIndex = TYPE_OPTIONS.findIndex((option) => option.value === type);

  // What an attempt was made with. An edit is a change to this; a retry is not.
  const draftSignature = JSON.stringify([type, body, severity]);
  const bodyCopy = type ? BODY_COPY[type] : null;
  const canSubmit = type !== null && body.trim().length > 0 && !isSubmitting;

  React.useEffect(() => {
    // #1416 — AN EDIT AFTER A FAILED ATTEMPT IS A NEW DELIVERY, NOT A RETRY.
    //
    // A submission whose insert commits but whose response is lost surfaces as an error while the
    // dialog keeps its key. If the user then rewrites what they were reporting and sends again, the
    // key is already committed, `ON CONFLICT DO NOTHING` drops the revised payload, and the dialog
    // reports success and clears the draft. The user watches their correction be accepted and it is
    // never stored — the worst possible outcome, because nothing looks wrong.
    //
    // Sending the SAME content again is a genuine retry and must keep deduplicating, so only an
    // actual edit rotates the identity.
    if (attempted === null || attempted.key !== idempotencyKey) return;
    if (attempted.signature === draftSignature) return;
    setIdempotencyKey(makeIdempotencyKey());
    setAttempted(null);
    setError(null);
  }, [attempted, draftSignature, idempotencyKey]);

  React.useEffect(() => {
    if (!open) return;
    // #1416 — ERASING EVERY FIELD MUST ERASE THE STORED COPY.
    //
    // This branch used to return without touching storage, so a user who typed a body, changed
    // their mind and deleted it left the deleted text behind: closing and reopening restored it,
    // and it survived in this tab for up to 24 hours. The user did the one thing that unambiguously
    // means "I don't want this saved", and the only path that honoured it was Cancel.
    if (isEmptyFeedbackDraft(type, body, severity)) {
      clearFeedbackDraft();
      return;
    }
    writeFeedbackDraft({
      ownerId: draftOwnerRef.current, type, body, severity, savedAt: Date.now(), idempotencyKey,
    });
  }, [body, idempotencyKey, open, severity, type]);

  React.useEffect(() => {
    const nextOwner = userId ?? null;
    if (draftOwnerRef.current === nextOwner) {
      if (nextOwner == null) clearFeedbackDraft();
      return;
    }

    // An auth transition retires the prior account's free-form draft even if the
    // navigation shell stays mounted. The next account must never inherit its text.
    // This effect covers only transitions this component is alive to see; sign-out
    // unmounts it, so `AuthProvider` owns that path.
    clearFeedbackDraft();
    draftOwnerRef.current = nextOwner;
    setType(null);
    setBody('');
    setSeverity(null);
    setIdempotencyKey(makeIdempotencyKey());
    setAttempted(null);
    setError(null);
    setOpen(false);
  }, [userId]);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      const context = resolvePageContext(location.pathname, surface);
      const draft = readFeedbackDraft(userId ?? null);
      setPageContext(context);
      setSnapshotSessionId(deriveSessionIdFromPath(location.pathname));
      setType(draft?.type ?? null);
      setBody(draft?.body ?? '');
      setSeverity(draft?.severity ?? null);
      setIdempotencyKey(draft?.idempotencyKey || makeIdempotencyKey());
      setAttempted(null);
      setError(null);
      setShowDisclosure(false);
    }
    setOpen(next);
  };

  const cancel = () => {
    clearFeedbackDraft();
    setType(null);
    setBody('');
    setSeverity(null);
    setIdempotencyKey(makeIdempotencyKey());
    setAttempted(null);
    setOpen(false);
  };

  const selectType = (next: FeedbackType) => {
    setType(next);
    if (next !== 'broke') setSeverity(null);
  };

  const handleTypeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = moveRadioFocus(event.key, index, TYPE_OPTIONS.length);
    // Tab and everything else fall through untouched, so Tab still LEAVES the group.
    if (nextIndex === null) return;
    event.preventDefault();
    selectType(TYPE_OPTIONS[nextIndex].value);
    typeRefs.current[nextIndex]?.focus();
  };

  const handleSeverityKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = moveRadioFocus(event.key, index, SEVERITY_OPTIONS.length);
    if (nextIndex === null) return;
    event.preventDefault();
    setSeverity(SEVERITY_OPTIONS[nextIndex].value);
    severityRefs.current[nextIndex]?.focus();
  };

  const submit = async () => {
    if (!canSubmit || type == null) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const feedbackKind: FeedbackKind = type === 'broke' ? 'issue' : 'comment';
      // #1416 — NULL, NOT A GUESS.
      //
      // This took the FIRST allowlisted area for the page and stored it as though the user had chosen
      // it. The redesigned form has no area selector, so there is nothing to derive from: every report
      // from a given screen would carry the same invented classification, and it would look like data.
      // A field that is confidently wrong is worse than one that is honestly empty, because a triage
      // query cannot tell the two apart.
      const issueArea = null;
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
      clearFeedbackDraft();
      setType(null);
      setBody('');
      setSeverity(null);
      setIdempotencyKey(makeIdempotencyKey());
      setAttempted(null);
      setOpen(false);
      toast.success('Thanks — we’ve got it.');
    } catch {
      setAttempted({ key: idempotencyKey, signature: draftSignature });
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
        /*
          #1416 — TOP-ANCHORED, so the reveal cannot move anything the user is already pointing at.
          `DialogContent` centres itself vertically (`top-[50%] translate-y-[-50%]`), so growing the
          form pushes its top edge UP by half the new height: the very type button the user just
          clicked slides out from under the pointer, and a different one takes its place. Anchoring
          the top means the reveal only ever adds space below itself — Send moves down and away, never
          under the cursor, and nothing above the new row moves at all.
        */
        className="top-[6vh] max-h-[88vh] translate-y-0 overflow-y-auto sm:max-w-xl"
        onOpenAutoFocus={(event) => {
          // #1416 — focus the RESTORED selection, not the first option.
          //
          // A radio group has one tab stop, and it is the checked option. Reopening onto a restored
          // draft focused `broke` while `idea` was the checked one carrying `tabIndex=0`: the focus
          // ring sat on an option the user had not chosen, arrow keys started from the wrong place,
          // and a screen reader announced an unchecked radio as the group's entry point. Someone
          // returning to their own draft was told, by the focus, that they had picked something else.
          event.preventDefault();
          typeRefs.current[typeIndex >= 0 ? typeIndex : 0]?.focus();
        }}
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
                    tabIndex={isRadioTabStop(index, typeIndex) ? 0 : -1}
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

          {/*
            #1416 — the conditional reveal, growing DOWNWARD only.
            The animated box is always mounted so the transition has something to run on, and it
            expands from `0fr` to `1fr` rather than toggling display, which is what makes the motion
            readable as "a new question appeared here" instead of a layout jump. Its contents are
            rendered only while revealed, so nothing inside is focusable or announced when collapsed.
            `prefers-reduced-motion` collapses the duration to zero — the row still appears, it just
            does not travel.
          */}
          <div
            data-testid="issue-report-severity-reveal"
            data-open={severityRevealed ? 'true' : 'false'}
            data-reveal-ms={String(revealMs)}
            aria-live="polite"
            className="grid overflow-hidden"
            style={{
              gridTemplateRows: severityRevealed ? '1fr' : '0fr',
              opacity: severityRevealed ? 1 : 0,
              transition: `grid-template-rows ${revealMs}ms ease-out, opacity ${revealMs}ms ease-out`,
            }}
          >
            <div className="min-h-0">
              {severityRevealed && (
                <div>
                  <div id="feedback-severity-label" className="mb-2 text-sm font-extrabold">Did it stop you?</div>
                  <div role="radiogroup" aria-labelledby="feedback-severity-label" data-testid="issue-report-severity-group" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {SEVERITY_OPTIONS.map((option, index) => {
                      const selected = severity === option.value;
                      return (
                        <button
                          key={option.value}
                          ref={(element) => { severityRefs.current[index] = element; }}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          tabIndex={isRadioTabStop(index, severityIndex) ? 0 : -1}
                          data-testid={`feedback-severity-${option.value}`}
                          onClick={() => setSeverity(option.value)}
                          onKeyDown={(event) => handleSeverityKeyDown(event, index)}
                          className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${selected ? 'border-2 border-[#d98a1f] bg-[#fdf3e2]' : 'border-[#dbe2ec] bg-white'}`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}

          <div className="border-t border-[#eef1f6] pt-4 text-xs font-semibold text-[#8b95a5]" data-testid="issue-report-page-context">
            {/*
              #1416 item 4 — PM-owned wording, exact.

              "no automatic transcript or audio" read as a promise that nothing the user contributes is
              sent, which is not true: the feedback box itself is submitted. The collapsed line now says
              what is NOT attached automatically, and the expanded text says plainly that whatever is
              typed IS included — so the two halves cannot be read as contradicting each other.

              The detail stays behind "What's included" so the default form remains short. The long
              introductory privacy block and the audio checkbox are deliberately NOT restored.
            */}
            Sent from <strong className="font-extrabold text-[#414b5c]">{pageContext.pageLabel}</strong> · transcript and audio aren&rsquo;t attached automatically.{' '}
            <button type="button" onClick={() => setShowDisclosure((value) => !value)} className="font-bold underline underline-offset-2">What&apos;s included</button>
            {showDisclosure && (
              <p className="mt-2 leading-relaxed" data-testid="issue-report-disclosure">
                We attach an internal account reference, this screen, the app version, and basic browser and operating-system details. We don&rsquo;t automatically attach your email, name, credentials, transcript, or audio. Anything you type in the feedback box is included in your report.
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
