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

/** Paths that always force the full lane: CI/orchestration, dependency, build/test config, DB. */
const FULL_LANE_PATTERNS = [
    /^\.github\//,
    /^scripts\//,
    /^package\.json$/,
    /^pnpm-lock\.yaml$/,
    /^pnpm-workspace\.yaml$/,
    /^frontend\/vitest\.config\./,
    /^frontend\/vite\.config\./,
    /^playwright[^/]*\.ts$/,
    /^tsconfig[^/]*\.json$/,
    /^backend\/supabase\/migrations\//,
    /^vercel\.json$/,
];

/** Documentation-ish paths (never on their own a reason to build or run E2E). */
const DOCS_PATTERNS = [/\.md$/, /^docs\//, /^product_release\//];

/** Frontend application/source surface. */
const FRONTEND_PATTERNS = [/^frontend\//];

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

/** Recognised-but-narrow paths that do not by themselves force the full lane. */
const RECOGNISED_PATTERNS = [
    ...DOCS_PATTERNS,
    ...FRONTEND_PATTERNS,
    ...EDGE_PATTERNS,
    ...E2E_PATTERNS,
    /^tests\//,
    /^backend\//,
];

const matches = (path, patterns) => patterns.some((re) => re.test(path));

/**
 * @param {string[]} changedFiles repo-relative paths
 * @param {{isDraft?: boolean, eventName?: string, forceFull?: boolean}} ctx
 */
export function classifyChanges(changedFiles, ctx = {}) {
    const { isDraft = false, eventName = 'pull_request', forceFull = false } = ctx;

    const full = {
        full_required: true,
        docs_only: false,
        frontend_changed: true,
        edge_changed: true,
        e2e_required: true,
        reason: '',
    };

    // A push to a protected branch, an explicit full request, or any non-draft PR (i.e. a merge
    // candidate) always gets complete validation.
    if (eventName === 'push') return { ...full, reason: 'push' };
    if (forceFull) return { ...full, reason: 'force_full' };
    if (!isDraft) return { ...full, reason: 'non_draft_pr' };

    // No resolvable diff => we cannot reason about scope => fail safe.
    if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
        return { ...full, reason: 'no_diff_resolved' };
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
    });
    console.log(`[ci-change-scope] ${JSON.stringify(result)}`);
    const out = process.env.GITHUB_OUTPUT;
    if (out) {
        for (const key of ['full_required', 'docs_only', 'frontend_changed', 'edge_changed', 'e2e_required']) {
            appendFileSync(out, `${key}=${result[key]}\n`);
        }
    }
}
