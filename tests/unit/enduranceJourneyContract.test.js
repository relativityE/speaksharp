import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// #1294 finding #5 — the Stress-and-Endurance browser journey (tests/soak/frontend-ui-memcheck.ts) went red
// because it drove the RETIRED session-shell selectors and a customer-facing Native mode picker that no longer
// exist. This contract pins the journey to the CURRENT seams and fails closed if any retired selector or a
// customer Native/mode choice returns. It scans source text (not a live browser) so it runs in the unit lane.
const SOAK = resolve(process.cwd(), 'tests/soak/frontend-ui-memcheck.ts');
const SRC = readFileSync(SOAK, 'utf8');

// Retired seams — none may appear in the endurance journey again.
const RETIRED = [
  { label: 'combined session-start-stop-button selector', re: /SESSION_START_STOP_BUTTON|session-start-stop-button/ },
  { label: 'customer STT mode <select>', re: /STT_MODE_SELECT|stt-mode-select/ },
  { label: 'customer "Native" mode option (a customer STT choice)', re: /STT_MODE_NATIVE|stt-mode-native/ },
  { label: 'retired session-status-indicator readiness selector', re: /SESSION_STATUS_INDICATOR|session-status-indicator/ },
];

// Current seams the journey MUST exercise.
const REQUIRED = [
  { label: 'mic-start recorder control', re: /getByTestId\('mic-start'\)/ },
  { label: 'recorder-stop control', re: /getByTestId\('recorder-stop'\)/ },
  { label: 'runtime-state RECORDING seam', re: /html\[data-runtime-state="RECORDING"\]/ },
  { label: 'during-state session shell', re: /\[data-testid="session-shell"\]\[data-session-state="during"\]/ },
  { label: 'internal __E2E_SET_MODE__ hook (not a customer control)', re: /__E2E_SET_MODE__/ },
];

describe('#1294 — endurance journey uses the current session shell, not retired selectors', () => {
  it.each(RETIRED)('has no retired reference: $label', ({ re }) => {
    expect(re.test(SRC), `retired seam present in ${SOAK}`).toBe(false);
  });

  it.each(REQUIRED)('exercises the current seam: $label', ({ re }) => {
    expect(re.test(SRC), `current seam missing in ${SOAK}`).toBe(true);
  });

  it('selects the engine only through the internal hook, never a clicked customer mode control', () => {
    // The one place the endurance path sets an engine is the internal __E2E_SET_MODE__ evaluate() — there is
    // no page.getByTestId(...Native/mode...).click(). Assert no ".click()" is chained to a mode/native testId.
    expect(/getByTestId\([^)]*(?:NATIVE|MODE|mode|native)[^)]*\)\s*\.click\(\)/.test(SRC)).toBe(false);
  });
});
