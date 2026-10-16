import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAX_REPORTED_PROVIDER_ATTEMPTS, reportedProviderAttempts } from '../practiceLoopTelemetry';
import { isValidForEventField } from '../telemetryAllowlist';

// #1258 option A (PM 6206983551 item 3) — the Edge function makes up to THREE provider attempts. The browser's report and
// the telemetry allowlist carry exactly that ceiling: 3 is retained, 4 is never retained (nor clamped into a believable 3).
describe('provider_attempts — the option A ceiling, end to end', () => {
    it('the ceiling equals the Edge function\'s own MAX_PROVIDER_ATTEMPTS', () => {
        const edge = readFileSync(resolve(__dirname, '../../../../backend/supabase/functions/get-ai-suggestions/providerRetry.ts'), 'utf8');
        expect(edge).toContain(`export const MAX_PROVIDER_ATTEMPTS = ${MAX_REPORTED_PROVIDER_ATTEMPTS};`);
    });

    it('the browser reports 0–3 as sent; 4, negatives, fractions and strings are not retained', () => {
        for (const n of [0, 1, 2, 3]) expect(reportedProviderAttempts(n)).toBe(n);
        for (const bad of [4, 9, -1, 1.5, '3', null, undefined]) expect({ bad, out: reportedProviderAttempts(bad) }).toEqual({ bad, out: 0 });
    });

    it('the allowlist accepts 3 and rejects 4', () => {
        expect(isValidForEventField('ai_coaching_diagnostic', 'provider_attempts', 3)).toBe(true);
        expect(isValidForEventField('ai_coaching_diagnostic', 'provider_attempts', 4)).toBe(false);
    });

    it('AISuggestions uses the strict helper, not a clamp', () => {
        const src = readFileSync(resolve(__dirname, '../../components/session/AISuggestions.tsx'), 'utf8');
        expect(src).toContain('provider_attempts: reportedProviderAttempts(server?.provider_attempts),');
        expect(src).not.toMatch(/provider_attempts: boundedInt\(/);
    });
});
