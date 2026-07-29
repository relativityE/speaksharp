import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * #1045 / PR #1091 — contract test for the get_analytics_summary v4 migration.
 *
 * There is no executable Postgres test harness in this repo (no pgTAP, no `supabase test db`, no
 * DB-backed integration runner for migrations), so migration behaviour is pinned the way the repo
 * already pins it for #1033: a static contract test over the SQL text. See
 * tests/release/attribution-status-migration-contract.test.ts for the precedent.
 *
 * The runtime CONTRACT this migration produces is separately pinned end-to-end at the hook boundary
 * in frontend/src/hooks/__tests__/useAnalytics.test.tsx.
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
const functionBody = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION get_analytics_summary'),
);

describe('#1091 get_analytics_summary evidence-validity migration contract', () => {
    it('is a NEW migration and does not edit the v3 definition in place', () => {
        const v3 = readFileSync(
            resolve(process.cwd(), 'backend', 'supabase', 'migrations', '20260213000000_analytics_rpc.sql'),
            'utf8',
        );
        // The v3 defect must still be present in the historical file — history is not rewritten.
        expect(v3).toContain('coalesce(sum(coalesce(clarity_score, accuracy * 100, 0)), 0)');
    });

    it('documents that it is not applied to production by this PR', () => {
        expect(migration).toMatch(/NOT APPLIED TO PRODUCTION BY THIS PR/i);
        expect(migration).toMatch(/Product Owner migration approval/i);
    });

    it('keeps the function name and the SECURITY DEFINER auth.uid() check', () => {
        expect(functionBody).toMatch(/CREATE OR REPLACE FUNCTION get_analytics_summary\(p_user_id UUID\)/);
        expect(functionBody).toMatch(/SECURITY DEFINER/);
        expect(functionBody).toMatch(/SET search_path = public/);
        expect(functionBody).toMatch(/IF p_user_id != auth\.uid\(\) THEN/);
        expect(functionBody).toMatch(/RAISE EXCEPTION 'Unauthorized/);
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
        expect(functionBody).not.toMatch(/v_sum_clarity \/ v_total_sessions/);
    });

    it('drops the accuracy*100 clarity substitution from the aggregate — accuracy is not clarity', () => {
        const aggregateSection = functionBody.slice(0, functionBody.indexOf('-- Top 2 Filler Words'));
        expect(aggregateSection).not.toMatch(/accuracy \* 100/);
    });

    it('returns contributor counts so the client can distinguish "low" from "no evidence"', () => {
        expect(functionBody).toMatch(/'clarityContributorCount', v_clarity_contributors/);
        expect(functionBody).toMatch(/'wpmContributorCount', v_word_time_sessions/);
        expect(functionBody).toMatch(/'fillerRateContributorCount', v_word_time_sessions/);
    });

    it('returns NULL rather than a fabricated 0.0 / 0 when there is no evidence', () => {
        const aggregateSection = functionBody.slice(0, functionBody.indexOf('-- Top 2 Filler Words'));
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
        expect(functionBody).not.toMatch(/v_sum_wpm/);
    });

    it('adds keys rather than renaming: every v3 overallStats key survives', () => {
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
        expect(functionBody).toMatch(/GRANT EXECUTE ON FUNCTION get_analytics_summary\(UUID\) TO authenticated;/);
        expect(functionBody).toMatch(/GRANT EXECUTE ON FUNCTION get_analytics_summary\(UUID\) TO service_role;/);
    });
});
