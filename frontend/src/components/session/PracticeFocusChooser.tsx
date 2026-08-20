import React from 'react';
import { PRACTICE_FOCUS_OPTIONS, type PracticeFocus } from '@/constants/practiceFocus';

/**
 * #1264 — the optional Open Mic "Practice Focus" chooser. A small, inline intention picker (NOT an
 * overlay, and separate from the shipped prompt/read-aloud helper). Rendered in the before-state coaching
 * slot for Open Mic only. It is a WAI-ARIA radiogroup: roving tabindex, arrow-key navigation, Home/End,
 * and Space/Enter to select. Selecting an intention is display-only — never a score.
 */
export interface PracticeFocusChooserProps {
  value: PracticeFocus | null;
  onSelect: (focus: PracticeFocus) => void;
  className?: string;
}

const PURPLE = '#6d28d9';

export const PracticeFocusChooser: React.FC<PracticeFocusChooserProps> = ({ value, onSelect, className = '' }) => {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  // The roving-tabindex anchor: the selected option, else the first (so Tab reaches the group once).
  const selectedIdx = PRACTICE_FOCUS_OPTIONS.findIndex((o) => o.id === value);
  const anchorIdx = selectedIdx >= 0 ? selectedIdx : 0;

  const focusAt = (i: number) => {
    const n = PRACTICE_FOCUS_OPTIONS.length;
    const idx = ((i % n) + n) % n;
    refs.current[idx]?.focus();
    onSelect(PRACTICE_FOCUS_OPTIONS[idx].id);
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        focusAt(i + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        focusAt(i - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(PRACTICE_FOCUS_OPTIONS.length - 1);
        break;
      case ' ':
      case 'Enter':
        e.preventDefault();
        onSelect(PRACTICE_FOCUS_OPTIONS[i].id);
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Practice focus (optional)"
      data-testid="practice-focus-chooser"
      className={`flex flex-wrap gap-2 ${className}`}
    >
      {PRACTICE_FOCUS_OPTIONS.map((opt, i) => {
        const checked = opt.id === value;
        return (
          <button
            key={opt.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={`${opt.label}. ${opt.hint}`}
            tabIndex={i === anchorIdx ? 0 : -1}
            data-testid={`practice-focus-${opt.id}`}
            onClick={() => onSelect(opt.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
              checked
                ? 'border-transparent text-white'
                : 'border-[#dbe2ec] bg-white text-[#414b5c] hover:border-[#c8b8f0]'
            }`}
            style={checked ? { backgroundColor: PURPLE } : undefined}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

export default PracticeFocusChooser;
