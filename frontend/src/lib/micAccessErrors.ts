/**
 * MICROPHONE ACCESS FAILURES, AS ONE ACTIONABLE MESSAGE EACH.
 *
 * A Start that cannot open the microphone used to end in one of two lines: a generic "blocked" message for a
 * permission denial, or a setup / raw failure for everything else. A person with no microphone, or with the
 * microphone held by a video call, was told nothing they could act on. This maps the browser's own
 * `getUserMedia` failure names to three issues, each with copy that says what to do, and the Start button
 * stays the retry.
 *
 * Only `NotAllowedError` / `PermissionDeniedError` are classified by name alone (they only mean a denied
 * permission). `SecurityError`, `NotFoundError` and `NotReadableError` are shared with storage and file APIs
 * (Private's model cache can raise them), so they count only on an error `createMicStream` marked as coming
 * from `getUserMedia` itself. The marker is a closed boolean; no message or device label is ever read here.
 */

export type MicAccessIssue = 'blocked' | 'not_found' | 'in_use';

/**
 * The blocked copy keeps its original first two sentences verbatim: live journeys and test harnesses match
 * on them, and the added sentence is the how-to.
 */
export const MIC_BLOCKED_MESSAGE =
    'Microphone access is blocked. Allow microphone access and try again. To allow it, open this site\'s settings from the icon next to the address bar and set Microphone to Allow.';
export const MIC_NOT_FOUND_MESSAGE =
    'No microphone was found. Connect a microphone or headset, check your computer can use it, then press Start recording.';
export const MIC_IN_USE_MESSAGE =
    'Your microphone is in use by another app or tab. Close the one using it (a video call, for example), then press Start recording.';

export const MIC_ACCESS_MESSAGES: Readonly<Record<MicAccessIssue, string>> = {
    blocked: MIC_BLOCKED_MESSAGE,
    not_found: MIC_NOT_FOUND_MESSAGE,
    in_use: MIC_IN_USE_MESSAGE,
};

const MIC_ACCESS_MESSAGE_SET: ReadonlySet<string> = new Set(Object.values(MIC_ACCESS_MESSAGES));

/** True when `message` is already one of the copies above (so a later display pass keeps it as it is). */
export function isMicAccessMessage(message: unknown): boolean {
    return typeof message === 'string' && MIC_ACCESS_MESSAGE_SET.has(message.replace(/^⚠️\s*/u, ''));
}

const MIC_ACQUISITION_FLAG = 'micAcquisition';

/** Marks an error thrown by `getUserMedia` itself. Returns the same error; a frozen value is left as it is. */
export function markMicAcquisitionError<T>(error: T): T {
    if (error !== null && typeof error === 'object') {
        try {
            Object.defineProperty(error, MIC_ACQUISITION_FLAG, { value: true, configurable: true, enumerable: false });
        } catch {
            // A non-extensible error stays unmarked: it then classifies by its permission name only.
        }
    }
    return error;
}

export function isMicAcquisitionError(error: unknown): boolean {
    return error !== null && typeof error === 'object'
        && (error as Record<string, unknown>)[MIC_ACQUISITION_FLAG] === true;
}

/** Names that only ever mean a denied microphone permission (current and legacy Chrome spelling). */
const PERMISSION_NAMES: ReadonlySet<string> = new Set(['NotAllowedError', 'PermissionDeniedError']);
/** Names that mean a microphone issue only when `getUserMedia` raised them. */
const ACQUISITION_NAMES: Readonly<Record<string, MicAccessIssue>> = {
    SecurityError: 'blocked',
    NotFoundError: 'not_found',
    DevicesNotFoundError: 'not_found',
    NotReadableError: 'in_use',
    TrackStartError: 'in_use',
};

function issueOf(error: unknown): MicAccessIssue | null {
    if (error === null || typeof error !== 'object') return null;
    const name = (error as { name?: unknown }).name;
    if (typeof name !== 'string') return null;
    if (PERMISSION_NAMES.has(name)) return 'blocked';
    if (isMicAcquisitionError(error) && Object.prototype.hasOwnProperty.call(ACQUISITION_NAMES, name)) {
        return ACQUISITION_NAMES[name];
    }
    return null;
}

/** The start wrapper the controller raises around a service that did not reach RECORDING; its cause is the leaf. */
const START_WRAPPER_PREFIX = 'TRANSCRIPTION_START_DID_NOT_RECORD:';

/**
 * The microphone issue behind a failed start, or null when it was not a microphone failure. Reads the error's
 * closed name (and, for the controller's start wrapper, its sanitized cause's name). Message text is read only to
 * recognise that wrapper's fixed prefix.
 */
export function micAccessIssue(error: unknown): MicAccessIssue | null {
    const direct = issueOf(error);
    if (direct) return direct;
    const message = (error as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && message.startsWith(START_WRAPPER_PREFIX)) {
        return issueOf((error as { cause?: unknown }).cause);
    }
    return null;
}
