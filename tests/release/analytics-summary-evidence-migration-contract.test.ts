import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * #1045 / PR #1091 — STATIC contract test for the get_analytics_summary v4 migration.
 *
 * This is the cheap, fast half. It pins INTENT that executing the function cannot show: the
 * production-authorization header, the documented provenance, and the absence of the specific
 * fabrication patterns the migration exists to remove. It follows the repo's existing pattern —
 * tests/release/attribution-status-migration-contract.test.ts (#1033).
 *
 * BEHAVIOUR is proved separately by EXECUTING this migration in a real PostgreSQL:
 *   tests/db/analytics-summary-rpc.integration.test.ts
 * and the client-side contract at the hook boundary:
 *   frontend/src/hooks/__tests__/useAnalytics.test.tsx
 */
const MIGRATION = '20260729130000_analytics_summary_evidence_validity.sql';
const migrationPath = resolve(
    process.cwd(),
    'backend',
    'supabase',
    'migrations',
    MIGRATION,
);
const migration = readFileSync(migrationPath, 'utf8');

/** Body of the v4 function only — excludes the header comment block. */
const CREATE_MARKER = 'CREATE OR REPLACE FUNCTION public.get_analytics_summary';
const createIndex = migration.indexOf(CREATE_MARKER);
const functionBody = migration.slice(createIndex);

/**
 * EXECUTABLE SQL only — `--` comments stripped.
 *
 * This migration deliberately QUOTES the defective expressions it removes, so that a future reader can
 * see what was wrong. Any "this pattern is gone" assertion must therefore run against code, not prose,
 * or it would fail on the documentation and tempt someone to delete the explanation.
 */
const codeOnly = (sql: string) =>
    sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

const functionCode = codeOnly(functionBody);

describe('#1091 get_analytics_summary evidence-validity migration contract', () => {
    it('is a NEW migration and does not edit the superseded definitions in place', () => {
        // Both historical files must be left intact — migration history is not rewritten.
        for (const f of ['20260213000000_analytics_rpc.sql', '20260522110000_cleanup_stale_schema_lint.sql']) {
            const old = readFileSync(
                resolve(process.cwd(), 'backend', 'supabase', 'migrations', f), 'utf8',
            );
            expect(old).toContain('coalesce(sum(coalesce(clarity_score, accuracy * 100, 0)), 0)');
        }
    });

    it('names the definition it actually supersedes, not just the original', () => {
        // 20260522110000 re-issued the function and is what is really deployed; documenting only
        // 20260213000000 would misstate what this migration replaces and what a rollback restores.
        expect(migration).toMatch(/20260522110000_cleanup_stale_schema_lint\.sql/);
        expect(migration).toMatch(/Rollback:[\s\S]*20260522110000/);
    });

    it('documents that it is not applied to production by this PR', () => {
        expect(migration).toMatch(/NOT APPLIED TO PRODUCTION BY THIS PR/i);
        expect(migration).toMatch(/Product Owner migration approval/i);
    });

    it('keeps the function name, schema-qualified so it cannot land in another schema', () => {
        expect(createIndex).toBeGreaterThan(-1);
        expect(functionBody).toMatch(/CREATE OR REPLACE FUNCTION public\.get_analytics_summary\(p_user_id UUID\)/);
        expect(functionBody).toMatch(/SECURITY DEFINER/);
        expect(functionBody).toMatch(/SET search_path = public/);
    });

    it('makes the authorization guard FAIL-CLOSED with the null-safe comparison', () => {
        // `p_user_id != auth.uid()` is NULL when auth.uid() is NULL, so the old RAISE never fired and
        // this SECURITY DEFINER function (which bypasses RLS) served data to an unidentified caller.
        expect(functionBody).toMatch(
            /IF auth\.uid\(\) IS NULL OR p_user_id IS DISTINCT FROM auth\.uid\(\) THEN/,
        );
        expect(functionBody).toMatch(/RAISE EXCEPTION 'Unauthorized/);
        expect(functionCode).not.toMatch(/IF p_user_id != auth\.uid\(\) THEN/);
        // The security work is a SEPARATE finding and must be flagged for its own review/authorization.
        expect(migration).toMatch(/SECURITY — SEPARATE FINDING, SEPARATE AUTHORIZATION LINE/);
        expect(migration).toMatch(/CROSS-TENANT DATA DISCLOSURE IS NOT PROVEN/);
    });

    it('closes the PUBLIC/anon execute gap the rest of the codebase already closes', () => {
        expect(functionCode).toMatch(
            /REVOKE EXECUTE ON FUNCTION public\.get_analytics_summary\(UUID\) FROM PUBLIC;/,
        );
        expect(functionCode).toMatch(
            /REVOKE EXECUTE ON FUNCTION public\.get_analytics_summary\(UUID\) FROM anon;/,
        );
    });

    it('removes the unused service_role grant rather than leaving standing privilege', () => {
        expect(functionCode).toMatch(
            /REVOKE EXECUTE ON FUNCTION public\.get_analytics_summary\(UUID\) FROM service_role;/,
        );
        expect(functionCode).not.toMatch(
            /GRANT EXECUTE ON FUNCTION public\.get_analytics_summary\(UUID\) TO service_role;/,
        );
        // ...and the one-line reversal is documented for the reviewer.
        expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_analytics_summary\(UUID\) TO service_role;/);
    });

    it('names the rule it mirrors as the CLARITY CONTRIBUTOR RULE, not session eligibility', () => {
        // #1045 separately owns a session-eligibility contract that excludes accidental/insufficient
        // takes from Progress and both takeaways. Conflating the two would let this PR appear to settle
        // a question it does not touch.
        expect(migration).toMatch(/CLARITY CONTRIBUTOR RULE/);
        expect(migration).toMatch(/NOT the #1045 session-eligibility contract/);
    });

    it('mirrors the client MIN_RELIABLE_SCORING_WORDS threshold of 3 as a named constant', () => {
        expect(functionBody).toMatch(/c_min_reliable_scoring_words CONSTANT INT := 3;/);
        expect(migration).toMatch(/MIN_RELIABLE_SCORING_WORDS/);
        // The comment must name the client file it mirrors, so the two cannot drift silently.
        expect(migration).toMatch(/sessionAnalysis\.ts/);
        expect(migration).toMatch(/analyticsUtils\.ts/);
    });

    it('averages clarity over eligible CONTRIBUTORS, not over every session', () => {
        // The eligibility predicate: real clarity value AND scorable word count.
        expect(functionBody).toMatch(
            /sum\(clarity_score\) FILTER \(\s*WHERE clarity_score IS NOT NULL\s*AND coalesce\(total_words, 0\) >= c_min_reliable_scoring_words\s*\)/,
        );
        expect(functionBody).toMatch(
            /count\(\*\) FILTER \(\s*WHERE clarity_score IS NOT NULL\s*AND coalesce\(total_words, 0\) >= c_min_reliable_scoring_words\s*\)/,
        );
        expect(functionBody).toMatch(/v_sum_clarity \/ v_clarity_contributors/);
        // and never over the all-sessions denominator that produced the false zero.
        expect(functionCode).not.toMatch(/v_sum_clarity \/ v_total_sessions/);
    });

    it('drops the accuracy*100 clarity substitution from the aggregate — accuracy is not clarity', () => {
        const aggregateSection = codeOnly(functionBody.slice(0, functionBody.indexOf('-- Top 2 Filler Words')));
        expect(aggregateSection).not.toMatch(/accuracy \* 100/);
    });

    it('returns contributor counts so the client can distinguish "low" from "no evidence"', () => {
        expect(functionBody).toMatch(/'clarityContributorCount', v_clarity_contributors/);
        expect(functionBody).toMatch(/'wpmContributorCount', v_word_time_sessions/);
        expect(functionBody).toMatch(/'fillerRateContributorCount', v_word_time_sessions/);
    });

    it('returns NULL rather than a fabricated 0.0 / 0 when there is no evidence', () => {
        const aggregateSection = codeOnly(functionBody.slice(0, functionBody.indexOf('-- Top 2 Filler Words')));
        // Every aggregate CASE in the overall-stats block ends in NULL, not a zero literal.
        expect(aggregateSection).toMatch(
            /v_avg_clarity := CASE[\s\S]*?ELSE NULL\s*END;/,
        );
        expect(aggregateSection).toMatch(
            /v_avg_wpm := CASE[\s\S]*?ELSE NULL\s*END;/,
        );
        expect(aggregateSection).toMatch(
            /v_avg_filler_per_min := CASE[\s\S]*?ELSE NULL\s*END;/,
        );
        // The v3 zero fallbacks must be gone from the aggregate block.
        expect(aggregateSection).not.toMatch(/ELSE '0\.0' END/);
        expect(aggregateSection).not.toMatch(/ELSE 0 END/);
    });

    it('fixes the sibling aggregates too — pace and filler rate both require words AND time', () => {
        expect(functionBody).toMatch(
            /v_avg_wpm := CASE\s*\n\s*WHEN v_total_duration_seconds > 0 AND v_total_words > 0/,
        );
        expect(functionBody).toMatch(
            /v_avg_filler_per_min := CASE\s*\n\s*WHEN v_total_duration_seconds > 0 AND v_total_words > 0/,
        );
        // Pace mirrors the client's aggregate rule (total words / total minutes), not a per-session mean.
        expect(functionBody).toMatch(/round\(v_total_words \/ \(v_total_duration_seconds \/ 60\.0\)\)/);
        expect(functionCode).not.toMatch(/v_sum_wpm/);
    });

    it('removes the fabricated chart point — never 0, never 100, no substitute formula', () => {
        const chartSection = codeOnly(functionBody.slice(
            functionBody.indexOf('-- Chart Data'),
            functionBody.indexOf('-- Accuracy Data'),
        ));
        // The exact fabrication being removed.
        expect(chartSection).not.toMatch(/coalesce\(clarity_score,/);
        expect(chartSection).not.toMatch(/ELSE 100 END\) as clarity/);
        expect(chartSection).not.toMatch(/100 - \(\(fw_count/);
        // Gated on the SAME clarity contributor rule as the aggregate, so a session can never be
        // plotted as scorable while being excluded from the average.
        expect(chartSection).toMatch(
            /WHEN clarity_score IS NOT NULL\s*\n\s*AND coalesce\(total_words, 0\) >= c_min_reliable_scoring_words\s*\n\s*THEN clarity_score\s*\n\s*ELSE NULL/,
        );
    });

    it('stops serving delivery clarity under the accuracyData "accuracy" key', () => {
        const accuracySection = codeOnly(functionBody.slice(
            functionBody.indexOf('-- Accuracy Data'),
            functionBody.indexOf('-- Weekly Sessions Count'),
        ));
        expect(accuracySection).not.toMatch(/coalesce\(clarity_score, accuracy \* 100\)/);
        expect(accuracySection).toMatch(/accuracy \* 100 as accuracy/);
        // Sessions with no real accuracy measurement are omitted from the series, not filled in.
        expect(accuracySection).toMatch(/AND accuracy IS NOT NULL/);
        expect(accuracySection).not.toMatch(/clarity_score IS NOT NULL OR accuracy IS NOT NULL/);
    });

    it('adds keys rather than renaming: every overallStats key survives', () => {
        for (const key of [
            "'totalSessions'",
            "'totalPracticeTime'",
            "'avgWpm'",
            "'avgFillerWordsPerMin'",
            "'avgAccuracy'",
        ]) {
            expect(functionBody).toContain(key);
        }
        // avgAccuracy stays as a compatibility alias carrying the SAME corrected clarity value.
        expect(functionBody).toMatch(/'avgAccuracy', v_avg_clarity/);
        expect(functionBody).toMatch(/'avgClarity', v_avg_clarity/);
    });

    it('leaves the non-aggregate sections and the grants intact', () => {
        for (const key of [
            "'topFillerWords'",
            "'fillerWordTrends'",
            "'accuracyData'",
            "'weeklySessionsCount'",
            "'weeklyActivity'",
            "'chartData'",
        ]) {
            expect(functionBody).toContain(key);
        }
        expect(functionBody).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_analytics_summary\(UUID\) TO authenticated;/);
    });
});
