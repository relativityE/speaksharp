/**
 * #1258 RWT punch list (implementation guide §0.2) — the ONE set of date, time, duration and plural formatters for
 * user-visible copy, so every screen says "7 Oct", "6:12 pm", "0:46" and "1 time" the same way.
 */
const MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const MONTH_Y = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** "7 Oct" (current year) or "7 Oct 2025". Local time. */
export function shortDate(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return (d.getFullYear() === new Date().getFullYear() ? MONTH : MONTH_Y).format(d);
}
/** "6:12 pm". Local time; am/pm lowercased where the locale uses it. */
export function shortTime(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return TIME.format(d).replace(/\b(AM|PM)\b/g, (m) => m.toLowerCase());
}
/** "0:46", "3:24". */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function times(n: number): string { return n === 1 ? '1 time' : `${n} times`; }
export function plural(n: number, one: string, many: string): string { return `${n} ${n === 1 ? one : many}`; }

export const PRODUCT_LABEL = { open_mic: 'Open Mic', focus_points: 'Focus Points' } as const;
export type ProductId = keyof typeof PRODUCT_LABEL;
