#!/usr/bin/env node
/**
 * CI change classifier (#1054).
 *
 * Decides which CI lane a change needs. The ONLY safety rule that matters: anything we do not
 * positively recognise as narrow-scope selects the FULL lane. Unknown impact must never silently
 * downgrade validation.
 *
 * Pure `classifyChanges()` so it can be unit-tested; the CLI wrapper writes GitHub outputs.
 */

/**
 * Paths that always force the full lane: CI/orchestration, dependency, build/test config, DB.
 * Exported for `review-qualification.mjs`, which treats the same paths as substantive implementation.
 */
export const FULL_LANE_PATTERNS = [
    // CI / orchestration / tooling
    /^\.github\//,
    /^scripts\//,
    // Executable Cloud-test harness code. Keep configuration, fixtures, seals and
    // test sources outside this pattern; those artifacts cannot establish that a
    // candidate contains substantive implementation by themselves.
    /^tools\/cloud-test\/(?:harness-adapter|harness\/bundle\/harness|report|scripts)\/(?!fixtures?\/)(?!.*\/fixtures?\/).*\.(?:cjs|mjs|js|ts|py|sh)$/,
    // dependency + workspace manifests (root AND package-level)
    /(^|\/)package\.json$/,
    /(^|\/)pnpm-lock\.yaml$/,
    /(^|\/)pnpm-workspace\.yaml$/,
    /(^|\/)deno\.jsonc?$/,
    /(^|\/)import_map\.json$/,
    /(^|\/)deno\.lock$/,
    // build / test / type / lint / style configuration anywhere
    /(^|\/)vite\.config\./,
    /(^|\/)vitest\.config\./,
    /(^|\/)playwright[^/]*\.(ts|js|mjs|cjs)$/,
    /(^|\/)tsconfig[^/]*\.json$/,
    /(^|\/)eslint\.config\./,
    /(^|\/)\.eslintrc/,
    /(^|\/)tailwind\.config\./,
    /(^|\/)postcss\.config\./,
    /(^|\/)babel\.config\./,
    // database + platform control
    /^backend\/supabase\/migrations\//,
    /^backend\/supabase\/config\.toml$/,
    /^vercel\.json$/,
    /(^|\/)Dockerfile$/,
];

/** Documentation-ish paths (never on their own a reason to build or run E2E). */
const DOCS_PATTERNS = [/\.md$/, /^docs\//, /^product_release\//];

/** Frontend application/source surface (explicit; NOT all of frontend/**). */
const FRONTEND_PATTERNS = [/^frontend\/src\//, /^frontend\/public\//, /^frontend\/index\.html$/];

/** Supabase edge functions. */
const EDGE_PATTERNS = [/^backend\/supabase\/functions\//];

/** User-visible surfaces whose change warrants browser validation. */
const E2E_PATTERNS = [
    /^frontend\/src\/pages\//,
    /^frontend\/src\/components\//,
    /^frontend\/src\/hooks\//,
    /^frontend\/src\/services\//,
    /^tests\/e2e\//,
];

/**
 * #1837 — THE DOCS LANE: a NON-DRAFT pull request whose every changed file is prose.
 *
 * Narrower than DOCS_PATTERNS on purpose. Only Markdown qualifies, and only outside the app (`frontend/`), the backend
 * and edge functions (`backend/`), the cloud-test tooling (`tools/`) and everything under `product_release/`, whose
 * canonical documents are release authorities with their own review scope (scripts/review-qualification.mjs). Control
 * paths (FULL_LANE_PATTERNS, e.g. `.github/**.md`, `scripts/**.md`) are rejected before this is consulted.
 *
 * The docs lane still runs the COMPLETE unit suite with coverage, the quality gate and the shard partition proof,
 * because unit tests are where documentation is read. It skips every other job, and only after
 * scripts/ci-docs-lane-guard.mjs has shown on the same checkout that none of those jobs reads a changed file
 * (`docsLaneConfirmed`). Pushes to main, merge-queue candidates and unconfirmed candidates take the full lane.
 */
export const DOCS_LANE_EXCLUDED = [/^frontend\//, /^backend\//, /^tools\//, /^product_release\//];

export function isDocsLaneFile(path) {
    if (typeof path !== 'string' || path.trim() === '' || path !== path.trim()) return false;
    if (!/\.md$/.test(path)) return false;
    if (matches(path, FULL_LANE_PATTERNS) || matches(path, DOCS_LANE_EXCLUDED)) return false;
    return true;
}

/** Every changed file qualifies for the docs lane (an empty or unreadable list never does). */
export function isDocsLaneChange(changedFiles) {
    return Array.isArray(changedFiles) && changedFiles.length > 0 && changedFiles.every(isDocsLaneFile);
}

/** Recognised-but-narrow paths that do not by themselves force the full lane. */
const RECOGNISED_PATTERNS = [
    ...DOCS_PATTERNS,
    ...FRONTEND_PATTERNS,
    ...EDGE_PATTERNS,
    ...E2E_PATTERNS,
    /^tests\//,
];

const matches = (path, patterns) => patterns.some((re) => re.test(path));

/**
 * @param {string[]} changedFiles repo-relative paths
 * @param {{isDraft?: boolean, eventName?: string, forceFull?: boolean, docsLaneConfirmed?: boolean}} ctx
 *   `docsLaneConfirmed` is true only when scripts/ci-docs-lane-guard.mjs has shown, on this checkout, that no job the
 *   docs lane skips reads a changed file. Without it a docs-lane candidate takes the full lane.
 */
export function classifyChanges(changedFiles, ctx = {}) {
    const { isDraft = false, eventName = 'pull_request', forceFull = false, docsLaneConfirmed = false } = ctx;

    const full = {
        full_required: true,
        docs_lane: false,
        docs_lane_candidate: false,
        docs_only: false,
        frontend_changed: true,
        edge_changed: true,
        e2e_required: true,
        reason: '',
    };

    // A push to a protected branch, an explicit full request, or any non-draft PR (i.e. a merge
    // candidate) always gets complete validation.
    if (eventName === 'push') return { ...full, reason: 'push' };
    // #1501 — a merge-queue candidate is the exact tree about to become `main`. It always gets the full
    // lane, explicitly: its event carries no pull_request draft flag, so relying on "not a draft" would be
    // correct only by accident.
    if (eventName === 'merge_group') return { ...full, reason: 'merge_group' };
    if (forceFull) return { ...full, reason: 'force_full' };
    // #1837 (Sam's review): every non-draft PR is a merge candidate and always takes the full lane, docs-only
    // changes included. The docs lane is a draft-only lane, so it never meets merge-qualification or AGENTS.md's
    // full-lane rule.
    if (!isDraft) return { ...full, reason: 'non_draft_pr' };

    // No resolvable diff => we cannot reason about scope => fail safe.
    if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
        return { ...full, reason: 'no_diff_resolved' };
    }

    // #1837 docs lane (drafts only): a draft `pull_request` whose resolved diff is entirely docs-lane prose takes
    // the docs lane once scripts/ci-docs-lane-guard.mjs has confirmed it on this checkout. An unconfirmed
    // candidate stays on the affected draft lane below, exactly as before the docs lane existed.
    const docsLaneCandidate = eventName === 'pull_request' && isDocsLaneChange(changedFiles);
    if (docsLaneCandidate && docsLaneConfirmed === true) {
        return {
            full_required: false,
            docs_lane: true,
            docs_lane_candidate: true,
            docs_only: true,
            frontend_changed: false,
            edge_changed: false,
            e2e_required: false,
            reason: 'docs_lane',
        };
    }

    let docsOnly = true;
    let frontendChanged = false;
    let edgeChanged = false;
    let e2eRequired = false;

    for (const raw of changedFiles) {
        const path = String(raw || '').trim();
        if (!path) continue;

        if (matches(path, FULL_LANE_PATTERNS)) {
            return { ...full, reason: `control_path:${path}` };
        }
        if (!matches(path, RECOGNISED_PATTERNS)) {
            return { ...full, reason: `unclassified_path:${path}` };
        }
        if (!matches(path, DOCS_PATTERNS)) docsOnly = false;
        if (matches(path, FRONTEND_PATTERNS)) frontendChanged = true;
        if (matches(path, EDGE_PATTERNS)) edgeChanged = true;
        if (matches(path, E2E_PATTERNS)) e2eRequired = true;
    }

    return {
        full_required: false,
        docs_lane: false,
        docs_lane_candidate: docsLaneCandidate,
        docs_only: docsOnly,
        frontend_changed: frontendChanged,
        edge_changed: edgeChanged,
        e2e_required: e2eRequired,
        reason: docsOnly ? 'docs_only' : 'affected',
    };
}

// ---- CLI ---------------------------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''));
if (isMain) {
    const [, , filesPath] = process.argv;
    const { readFileSync, appendFileSync } = await import('node:fs');
    let files = [];
    try {
        files = readFileSync(filesPath, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
    } catch {
        files = []; // unreadable diff => classifyChanges fails safe to the full lane
    }
    const result = classifyChanges(files, {
        isDraft: process.env.IS_DRAFT === 'true',
        eventName: process.env.EVENT_NAME || 'pull_request',
        forceFull: process.env.FORCE_FULL === 'true',
        docsLaneConfirmed: process.env.DOCS_LANE_CONFIRMED === 'true',
    });
    console.log(`[ci-change-scope] ${JSON.stringify(result)}`);
    // #1837: the docs lane's authority job re-runs this classifier on its own checkout and refuses to
    // qualify unless the diff is still docs-lane prose, independently of the `scope` job's outputs.
    if (process.env.REQUIRE_DOCS_LANE === 'true' && result.docs_lane !== true) {
        console.log(`::error::not a docs-lane change (${result.reason}); refusing docs-lane qualification`);
        process.exit(1);
    }
    const out = process.env.GITHUB_OUTPUT;
    if (out) {
        for (const key of ['full_required', 'docs_lane', 'docs_lane_candidate', 'docs_only', 'frontend_changed', 'edge_changed', 'e2e_required']) {
            appendFileSync(out, `${key}=${result[key]}\n`);
        }
    }
}
