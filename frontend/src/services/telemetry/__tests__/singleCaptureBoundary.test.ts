import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * #1259 — THE BOUNDARY IS ONE BOUNDARY, ENFORCED.
 *
 * The audit found three capture paths, not one, and the third was invisible to the search that found
 * the first two: `posthog?.capture?.(...)` does not match a scan for `posthog.capture`. It shipped
 * `private_stt_v4_attempt` with its RAW payload — no envelope, no schema, no allowlist of any kind —
 * and PostHog confirms that event has live Production traffic. The module comments meanwhile described
 * `AnalyticsBuffer` as the single boundary.
 *
 * A behavioural test cannot express "no OTHER module calls posthog", so this is a structural guard, and
 * it is written against the MODULE GRAPH rather than text offsets: the set of files importing
 * `posthog-js` must equal an approved set. A new capture path cannot appear without importing the SDK,
 * and adding an import to this list is a reviewable act.
 */

const SRC = resolve(process.cwd(), 'frontend/src');

/** Files permitted to import the SDK at all, each for a stated reason. */
const APPROVED = new Set([
    'main.tsx',                                  // posthog.init — the SDK's own bootstrap
    'services/AnalyticsBuffer.ts',               // THE capture boundary
    'services/transcription/safetyKill.ts',      // feature flag reads only
    'services/transcription/privateV4Flags.ts',  // feature flag reads only
]);

/** Only the boundary may capture. Flag readers import the SDK but must never emit. */
const MAY_CAPTURE = new Set(['services/AnalyticsBuffer.ts']);

function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === '__tests__' || entry === 'node_modules') continue;
            walk(full, acc);
        } else if (/\.tsx?$/.test(entry)) {
            acc.push(full);
        }
    }
    return acc;
}

const sourceFiles = walk(SRC).map((f) => ({ rel: f.slice(SRC.length + 1), text: readFileSync(f, 'utf8') }));

describe('#1259 — exactly one capture boundary', () => {
    it('finds source files to scan (a guard that scans nothing proves nothing)', () => {
        expect(sourceFiles.length).toBeGreaterThan(100);
    });

    it('only approved modules import the PostHog SDK', () => {
        const importers = sourceFiles
            .filter((f) => /from ['"]posthog-js['"]/.test(f.text))
            .map((f) => f.rel)
            .sort();
        expect(importers).toEqual([...APPROVED].sort());
    });

    it('only the boundary calls capture — optional chaining included', () => {
        // `posthog?.capture?.(` is the form that hid the third boundary from the original audit, so the
        // pattern must tolerate optional chaining on both the object and the method.
        const CAPTURE = /posthog\s*\??\.\s*capture\s*\??\.?\s*\(/;
        const offenders = sourceFiles
            .filter((f) => CAPTURE.test(f.text.replace(/^\s*(\/\/|\*).*$/gm, '')))
            .map((f) => f.rel)
            .sort();
        expect(offenders).toEqual([...MAY_CAPTURE].sort());
    });

    it('the pattern actually matches the form that escaped the first audit', () => {
        // A guard whose regex cannot match the historical defect is a guard that would not have caught it.
        const CAPTURE = /posthog\s*\??\.\s*capture\s*\??\.?\s*\(/;
        expect(CAPTURE.test("try { posthog?.capture?.('private_stt_v4_attempt', payload); } catch {}")).toBe(true);
        expect(CAPTURE.test('posthog.capture(event.event, {')).toBe(true);
    });
});
