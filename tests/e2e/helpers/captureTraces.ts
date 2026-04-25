/**
 * captureTraces — In-browser trace capture for E2E forensic tests.
 *
 * WHY: Playwright's `page.on('console')` listener is unreliable for capturing
 * console messages emitted synchronously during `page.evaluate()`. Messages
 * fire inside the browser's JS context, and the CDP protocol may not relay
 * them back to Node before the evaluate() promise resolves.
 *
 * SOLUTION: Monkey-patch console.warn/info/log inside the browser context,
 * capture matching messages into an array, run the async action, restore
 * originals, and return the captured traces.
 *
 * USAGE:
 * ```ts
 * import { captureTracesForDestroy } from '../helpers/captureTraces';
 *
 * const traces = await captureTracesForDestroy(page, {
 *   patterns: ['[TRACE]', 'CLEANING_UP', 'TERMINATED', 'Lock released'],
 * });
 * expect(traces.some(t => t.includes('CLEANING_UP'))).toBe(true);
 * ```
 *
 * For custom actions, use `captureTracesWithAction`:
 * ```ts
 * const traces = await captureTracesWithAction(page, {
 *   patterns: ['[TRACE]'],
 *   actionScript: 'await window.__SS_E2E__.startRecording()',
 * });
 * ```
 */
import { Page } from '@playwright/test';

/** Standard forensic trace patterns for the teardown sequence */
export const TEARDOWN_PATTERNS = [
  '[TRACE]',
  'CLEANING_UP',
  'TERMINATED',
  'Lock released',
  'STATE_TRANSITION',
  'destroy()',
];

interface CaptureOptions {
  /** Substrings to match — only messages containing at least one pattern are captured */
  patterns?: string[];
}

/**
 * Captures console traces during a destroyService() call.
 * This is the most common forensic action.
 */
export async function captureTracesForDestroy(
  page: Page,
  options: CaptureOptions = {}
): Promise<string[]> {
  const patterns = options.patterns ?? TEARDOWN_PATTERNS;

  return page.evaluate(async (p: string[]) => {
    const captured: string[] = [];
    const origWarn = console.warn;
    const origInfo = console.info;
    const origLog = console.log;

    const capture = (...args: unknown[]) => {
      const text = args
        .map(a => (typeof a === 'string' ? a : JSON.stringify(a)))
        .join(' ');
      if (p.some(pattern => text.includes(pattern))) {
        captured.push(text);
      }
    };

    console.warn = (...args: unknown[]) => { capture(...args); origWarn.apply(console, args); };
    console.info = (...args: unknown[]) => { capture(...args); origInfo.apply(console, args); };
    console.log = (...args: unknown[]) => { capture(...args); origLog.apply(console, args); };

    interface E2EBridge {
      destroyService: () => Promise<void>;
    }
    const win = window as unknown as { __SS_E2E__?: E2EBridge };
    await win.__SS_E2E__?.destroyService();

    console.warn = origWarn;
    console.info = origInfo;
    console.log = origLog;

    return captured;
  }, patterns);
}
