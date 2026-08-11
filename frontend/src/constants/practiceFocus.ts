/**
 * #1264 — optional Open Mic "Practice Focus": one small intention the speaker can set before a freeform
 * take. It is NOT a score and does not change transcript truth or engine policy — it is a reminder that
 * rides along with the session and is preserved through a "Practice this next" repeat.
 */
export type PracticeFocus =
  | 'just_practice'
  | 'concise'
  | 'reduce_fillers'
  | 'steady_pace'
  | 'deliver_clearly';

export interface PracticeFocusOption {
  id: PracticeFocus;
  /** Short chooser label. */
  label: string;
  /** One-line supporting hint (a11y description + subtle helper text). */
  hint: string;
}

export const PRACTICE_FOCUS_OPTIONS: readonly PracticeFocusOption[] = [
  { id: 'just_practice', label: 'Just practice', hint: 'No agenda — just talk.' },
  { id: 'concise', label: 'Be concise', hint: 'Say more with fewer words.' },
  { id: 'reduce_fillers', label: 'Reduce fillers', hint: 'Fewer um / uh / like.' },
  { id: 'steady_pace', label: 'Steady pace', hint: 'Even, unhurried delivery.' },
  { id: 'deliver_clearly', label: 'Deliver clearly', hint: 'Clear, confident phrasing.' },
];

const BY_ID = new Map<PracticeFocus, PracticeFocusOption>(PRACTICE_FOCUS_OPTIONS.map((o) => [o.id, o]));

export const isPracticeFocus = (value: unknown): value is PracticeFocus =>
  typeof value === 'string' && BY_ID.has(value as PracticeFocus);

export const practiceFocusLabel = (id: PracticeFocus | null | undefined): string | null =>
  id ? BY_ID.get(id)?.label ?? null : null;
