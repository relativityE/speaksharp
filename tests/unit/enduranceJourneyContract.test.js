import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// #1294 finding #5 (Option 1) — the Stress-and-Endurance browser journey must run the REAL customer Private
// engine, with the deterministic transcription double kept BEHIND the Private adapter boundary. This contract
// FAILS CLOSED if any Native / Browser / Cloud engine path, a customer mode-selector, or the retired
// private_sample allowance returns to the soak journey, and it requires the current mic-start / recorder-stop /
// runtime-state=Private seams. It scans source text (not a live browser) so it runs in the unit lane.
const SOAK = resolve(process.cwd(), 'tests/soak/frontend-ui-memcheck.ts');
const SRC = readFileSync(SOAK, 'utf8');

// Forbidden mechanism tokens (precise — never the bare words "browser"/"native" that legitimately appear in
// the test name "Browser Endurance" or Playwright's browser contexts). Each is an actual off-Private path.
const FORBIDDEN = [
  { label: 'retired combined start/stop selector', re: /SESSION_START_STOP_BUTTON|session-start-stop-button/ },
  { label: 'customer STT mode <select>', re: /STT_MODE_SELECT|stt-mode-select/ },
  { label: 'customer Native mode option', re: /STT_MODE_NATIVE|stt-mode-native/ },
  { label: 'native-force E2E flag', re: /forceNativeMode/ },
  { label: 'programmatic engine setter hook', re: /__E2E_SET_MODE__/ },
  { label: 'USE_NATIVE_MODE config toggle', re: /USE_NATIVE_MODE/ },
  { label: 'controller switchToNative()', re: /switchToNative/ },
  { label: 'native-browser engine registration', re: /native-browser/ },
  { label: 'Cloud AssemblyAI engine', re: /assemblyai/i },
  { label: 'retired private_sample allowance path', re: /private_sample/ },
  { label: 'a resolved-mode assertion for native/cloud', re: /data-stt-resolved-mode="(?:native|cloud)"/ },
];

// Current Private seams the journey MUST exercise.
const REQUIRED = [
  { label: 'mic-start recorder control', re: /getByTestId\('mic-start'\)/ },
  { label: 'recorder-stop control', re: /getByTestId\('recorder-stop'\)/ },
  { label: 'runtime-state RECORDING resolved to PRIVATE', re: /html\[data-runtime-state="RECORDING"\]\[data-stt-resolved-mode="private"\]/ },
  { label: 'during-state session shell', re: /\[data-testid="session-shell"\]\[data-session-state="during"\]/ },
  { label: 'fail-with-reason if Private cannot start', re: /Private recording did not start/ },
];

describe('#1294 — endurance journey runs real Private, no Native/Browser/Cloud/mode-selector/private_sample', () => {
  it.each(FORBIDDEN)('has no off-Private reference: $label', ({ re }) => {
    expect(re.test(SRC), `forbidden path present in ${SOAK}`).toBe(false);
  });

  it.each(REQUIRED)('exercises the current Private seam: $label', ({ re }) => {
    expect(re.test(SRC), `required Private seam missing in ${SOAK}`).toBe(true);
  });

  it('never clicks a mode/engine control (there is no customer engine choice)', () => {
    expect(/getByTestId\([^)]*(?:NATIVE|MODE|mode|native|cloud|browser)[^)]*\)\s*\.click\(\)/.test(SRC)).toBe(false);
  });
});
