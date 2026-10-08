/**
 * #1573 (Browser PM 6067238534) — THE REVIEW LANE REUSES ENGINEERING EVIDENCE; IT NEVER RE-RUNS IT.
 *
 * Review activity used to trigger `ci.yml` itself, forcing the full lane and cancelling the code run in the shared
 * `ci-<PR>` group. The review lane (`review-qualification.yml`) instead asks one narrow question here: is there a
 * COMPLETED, SUCCESSFUL engineering run of `ci.yml` for this PR's exact live head, against its live base? Anything less —
 * a moved head, no run, a newer run still going or failed, a cancelled run, a draft-lane run, a missing job, another
 * base — HOLDS. The newest run for the head decides; an older green run never stands in for a newer one.
 *
 * `report` (the only required context), `full-evidence` and `scope` must all be `success`. `full-evidence` itself refuses
 * to succeed unless unit, edge, build, health and E2E succeeded, so the full lane's evidence is covered without restating
 * matrix job names.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Why engineering evidence did not qualify. Bounded and content-free. */
export const ENGINEERING_HOLD = Object.freeze({
    HEAD_MOVED: 'engineering_head_moved',
    NO_RUN: 'engineering_no_run_for_exact_head',
    NOT_COMPLETED: 'engineering_run_not_completed',
    RUN_NOT_SUCCESSFUL: 'engineering_run_not_successful',
    JOB_NOT_SUCCESSFUL: 'engineering_required_job_not_successful',
    BASE_MISMATCH: 'engineering_base_mismatch',
});

/** Runs of `ci.yml` started by a code event. Review-event runs (pre-#1573) are not engineering evidence. */
export const ENGINEERING_EVENTS = Object.freeze(['pull_request', 'push', 'merge_group', 'workflow_dispatch']);
export const REQUIRED_ENGINEERING_JOBS = Object.freeze(['scope', 'full-evidence', 'report']);

const newestFirst = (a, b) => (Date.parse(b.created_at) - Date.parse(a.created_at)) || (b.id - a.id);

/**
 * @param {{ pr: number, liveHeadSha: string, liveBaseSha: string, expectedHeadSha?: string, runs: object[],
 *           jobsByRun: Record<string, Record<string, string>>, headContainsBase: boolean }} input
 */
export function evaluateEngineeringEvidence({ pr, liveHeadSha, liveBaseSha, expectedHeadSha, runs, jobsByRun, headContainsBase }) {
    const hold = (reason, runId = null) => ({ qualified: false, runId, reasons: [reason] });
    if (expectedHeadSha && expectedHeadSha !== liveHeadSha) return hold(ENGINEERING_HOLD.HEAD_MOVED);
    const candidates = (runs ?? [])
        .filter((r) => r && r.head_sha === liveHeadSha && ENGINEERING_EVENTS.includes(r.event))
        .sort(newestFirst);
    const newest = candidates[0];
    if (!newest) return hold(ENGINEERING_HOLD.NO_RUN);
    if (newest.status !== 'completed') return hold(ENGINEERING_HOLD.NOT_COMPLETED, newest.id);
    if (newest.conclusion !== 'success') return hold(ENGINEERING_HOLD.RUN_NOT_SUCCESSFUL, newest.id);
    const jobs = jobsByRun?.[newest.id] ?? {};
    if (REQUIRED_ENGINEERING_JOBS.some((name) => jobs[name] !== 'success')) return hold(ENGINEERING_HOLD.JOB_NOT_SUCCESSFUL, newest.id);
    const prLink = (newest.pull_requests ?? []).find((p) => p && p.number === pr);
    const baseOk = prLink?.base?.sha ? prLink.base.sha === liveBaseSha : headContainsBase === true;
    if (!baseOk) return hold(ENGINEERING_HOLD.BASE_MISMATCH, newest.id);
    return { qualified: true, runId: newest.id, reasons: [] };
}

async function gh(path, token) {
    const res = await fetch(`https://api.github.com${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path.split('?')[0]}`);
    return res.json();
}

async function main() {
    const repository = process.env.GITHUB_REPOSITORY ?? '';
    const token = process.env.GITHUB_TOKEN ?? '';
    const pr = Number(process.env.PR_NUMBER);
    const expectedHeadSha = process.env.EXPECTED_HEAD_SHA ?? '';
    if (!repository || !token || !Number.isInteger(pr) || pr <= 0) {
        console.error('::error::ci-engineering-evidence: GITHUB_REPOSITORY, GITHUB_TOKEN and PR_NUMBER are required');
        process.exit(2);
    }
    const pull = await gh(`/repos/${repository}/pulls/${pr}`, token);
    const liveHeadSha = pull.head.sha;
    const liveBaseSha = pull.base.sha;
    const { workflow_runs: runs } = await gh(`/repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${liveHeadSha}&per_page=50`, token);
    const newest = (runs ?? []).filter((r) => r.head_sha === liveHeadSha && ENGINEERING_EVENTS.includes(r.event)).sort(newestFirst)[0];
    const jobsByRun = {};
    if (newest) {
        const { jobs } = await gh(`/repos/${repository}/actions/runs/${newest.id}/jobs?filter=latest&per_page=100`, token);
        jobsByRun[newest.id] = Object.fromEntries((jobs ?? []).map((j) => [j.name, j.conclusion]));
    }
    const compare = await gh(`/repos/${repository}/compare/${liveBaseSha}...${liveHeadSha}`, token);
    const headContainsBase = compare.status === 'ahead' || compare.status === 'identical';
    const decision = evaluateEngineeringEvidence({ pr, liveHeadSha, liveBaseSha, expectedHeadSha, runs, jobsByRun, headContainsBase });
    const record = { pr, liveHeadSha, liveBaseSha, ...decision };
    console.log(JSON.stringify(record));
    if (process.env.ENGINEERING_EVIDENCE_FILE) writeFileSync(process.env.ENGINEERING_EVIDENCE_FILE, `${JSON.stringify(record, null, 2)}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Engineering evidence\n\n${decision.qualified ? `Qualified by run ${decision.runId}` : `HOLD: ${decision.reasons.join(', ')}`}\n`);
    }
    if (!decision.qualified) {
        console.log(`::error::engineering evidence does not qualify head ${liveHeadSha}: ${decision.reasons.join(', ')}`);
        process.exit(1);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
