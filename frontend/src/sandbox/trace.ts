/**
 * Phase 2 SANDBOX local, in-memory, CONTENT-FREE interaction trace.
 *
 * This exists ONLY so the CDP monitor can prove which review interactions happened without capturing
 * any content. It is a plain in-memory array on `window.__SS_SANDBOX_TRACE__`. It NEVER calls PostHog,
 * Sentry, or any network service, and it MUST NOT carry transcript text, agenda/brief prose, email,
 * identity, or any free text — only allowlisted enums, ids, counts, and a monotonic elapsed time.
 */

export type SandboxEventName =
  | 'sandbox_loaded'
  | 'practice_mode_selected'
  | 'fixture_selected'
  | 'target_details_opened'
  | 'illustrative_target_edited'
  | 'agenda_state_inspected'
  | 'remedy_requested'
  | 'recovery_state_viewed';

/** Allowlisted, content-free properties. No free text, identity, or content is permitted. */
export interface SandboxEventProps {
  fixtureId?: string;
  mode?: 'general' | 'rehearsal';
  targetType?: 'lowerThreshold' | 'upperThreshold' | 'range';
  agendaState?: 'not_addressed' | 'partial' | 'covered' | 'recovered';
  visibleItemCount?: number;
}

export interface SandboxTraceEvent extends SandboxEventProps {
  name: SandboxEventName;
  /** Monotonic ms since trace init (performance.now); never a wall-clock timestamp. */
  elapsedMs: number;
}

declare global {
  interface Window {
    __SS_SANDBOX_TRACE__?: SandboxTraceEvent[];
  }
}

const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

function elapsed(): number {
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  return Math.round(now - t0);
}

/** Strip anything not on the allowlist — defense-in-depth against accidental content leakage. */
function sanitize(props: SandboxEventProps): SandboxEventProps {
  const out: SandboxEventProps = {};
  if (typeof props.fixtureId === 'string') out.fixtureId = props.fixtureId.slice(0, 40);
  if (props.mode === 'general' || props.mode === 'rehearsal') out.mode = props.mode;
  if (props.targetType) out.targetType = props.targetType;
  if (props.agendaState) out.agendaState = props.agendaState;
  if (typeof props.visibleItemCount === 'number' && Number.isFinite(props.visibleItemCount)) {
    out.visibleItemCount = Math.max(0, Math.round(props.visibleItemCount));
  }
  return out;
}

/** Record a content-free sandbox interaction event to the in-memory trace. */
export function trace(name: SandboxEventName, props: SandboxEventProps = {}): void {
  if (typeof window === 'undefined') return;
  if (!window.__SS_SANDBOX_TRACE__) window.__SS_SANDBOX_TRACE__ = [];
  window.__SS_SANDBOX_TRACE__.push({ name, elapsedMs: elapsed(), ...sanitize(props) });
}
