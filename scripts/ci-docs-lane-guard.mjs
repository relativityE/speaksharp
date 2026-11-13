#!/usr/bin/env node
/**
 * #1837 — CHECK THAT NOTHING THE DOCS LANE SKIPS NAMES THE MARKDOWN THIS PULL REQUEST CHANGED. FAIL CLOSED.
 *
 * This is a static check of the code the skipped jobs run, not a proof from a run-time trace: it finds every way the
 * files and commands name a changed file, and refuses anything it cannot read, but a read assembled at run time from
 * pieces it does not recognise is outside what it can see. The Markdown review list below covers the known patterns.
 *
 * The docs lane (scripts/ci-change-scope.mjs `docs_lane`, draft PRs only) runs the complete unit suite with coverage, the
 * quality gate and the shard partition proof, and skips every other job in .github/workflows/ci.yml. That skip
 * is only sound if no skipped job can observe the changed files. This guard derives the skipped jobs from the
 * workflow itself (so a job added later is covered without editing this file), expands every command they run
 * into the repository files it executes, follows those files' references transitively, and then answers:
 *
 *   1. Does any skipped surface reference a changed file directly, or a directory that contains one?
 *   2. Does any skipped surface mention a Markdown name that a changed path ends with, or a Markdown pattern
 *      that has not been reviewed into REVIEWED_MARKDOWN_MENTIONS below?
 *
 * Either answer is "yes" => the change does not qualify for the docs lane. The scope job then keeps the draft on
 * the affected draft lane; the docs-evidence job refuses to qualify. Comments are ignored for JavaScript and TypeScript (parsed
 * with the TypeScript compiler); shell, Python and YAML are scanned with their `#` comments stripped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';
import ts from 'typescript';
import { isDocsLaneFile } from './ci-change-scope.mjs';

/** Jobs the docs lane RUNS. Every other job in ci.yml is a skipped surface and is scanned. */
export const DOCS_LANE_JOBS = Object.freeze(['scope', 'deps-prep', 'unit-shard', 'quality', 'unit-coverage-merge',
    'docs-evidence', 'report']);

/**
 * Jobs that also do not run on the docs lane but are not test surfaces for a docs change, with the reason.
 * The guard fails if one of these disappears from the workflow, so the list cannot silently go stale.
 */
export const NOT_TEST_SURFACES = Object.freeze({
    'draft-checks': 'drafts only; every test it runs is part of the complete unit suite the docs lane runs, and its diff, env and billing checks run in docs-evidence',
    'review-qualification': 'reads review state from GitHub; a docs-lane change has no review scope (scripts/review-qualification.mjs)',
    'merge-qualification': 'reads job conclusions only; the docs lane runs on drafts only and is never merge-qualified',
});

/**
 * Markdown mentions in skipped surfaces that were read by hand and cannot read a docs-lane file. Keyed by
 * `<file>::<the whole string that contains the mention>`, so the same name in a NEW string (a real read added
 * later) is not covered. Every other mention is enforced: a pattern fails the guard, a concrete name matches
 * any changed path that ends with it. tests/unit/ciDocsLaneGuard.test.js fails on an entry that no longer matches.
 */
export const REVIEWED_MARKDOWN_MENTIONS = Object.freeze({
    'tools/cloud-test/config/test-config.v1.json::**/*.md':
        'release.testPathPatterns: a path classifier for tools/cloud-test/scripts/verify_release.py, which ci.yml never runs; it selects no file to read',
    'scripts/validate-env.mjs::See README.md for setup instructions.':
        'console.error text printed when environment variables are missing; nothing is read',
});

const CODE = /\.(?:[cm]?[jt]sx?)$/;
const GLOB = /[*?{}[\]$,]/;
const MARKDOWN_FILE = /\.(?:md|mdx|markdown)$/i;
const EXECUTABLE = /(?:\.(?:[cm]?[jt]sx?|sh|bash|py)|(?:^|\/)[^/]*config[^/]*\.(?:json|ya?ml|toml))$/;
const TEST_FILE = /(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

/**
 * Directories a skipped job's test runner executes in full: the Vite build's source tree, Playwright's testDir and the
 * Deno edge-function suite. tests/unit/ciDocsLaneGuard.test.js pins each one to the configuration that selects it.
 */
export const RUNNER_ROOTS = Object.freeze(['frontend', 'tests/e2e', 'backend/supabase/functions']);
const MARKDOWN_TOKEN = /[\w@*?{},.\-/[\]$]*\.(?:md|mdx|markdown)(?![\w])/gi;
const PATH_TOKEN = /(?:\.{1,2}\/)?[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)+\/?/g;
const RESOLVE_EXTENSIONS = ['', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '/index.js', '/index.ts', '/index.tsx', '/index.mjs'];


/** Tracked files of the checkout, as repository-relative POSIX paths. */
export function trackedFiles(root) {
    return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
        .split('\0').filter(Boolean);
}

/** Every `run:` text and local `uses:` of the jobs the docs lane skips, with their job names. */
export function skippedSurfaces(workflow) {
    const jobs = workflow?.jobs;
    if (!jobs || typeof jobs !== 'object') throw new Error('ci.yml has no jobs');
    for (const name of [...DOCS_LANE_JOBS, ...Object.keys(NOT_TEST_SURFACES)]) {
        if (!jobs[name]) throw new Error(`ci.yml no longer defines job ${name}; review the docs-lane guard`);
    }
    const surfaces = [];
    for (const [name, job] of Object.entries(jobs)) {
        if (DOCS_LANE_JOBS.includes(name) || Object.hasOwn(NOT_TEST_SURFACES, name)) continue;
        const commands = [];
        for (const step of job.steps ?? []) {
            if (typeof step.run === 'string') commands.push(step.run);
            if (typeof step.uses === 'string' && step.uses.startsWith('./')) commands.push(step.uses);
        }
        surfaces.push({ job: name, commands });
    }
    return surfaces;
}

/** `pnpm [run|exec] <script>` names a package.json script; expand it (recursively) into its command text. */
function expandPnpmScripts(text, scripts, seen = new Set()) {
    let out = text;
    for (const match of text.matchAll(/\bpnpm\s+(?:run\s+)?([\w:.-]+)/g)) {
        const name = match[1];
        if (seen.has(name) || typeof scripts[name] !== 'string') continue;
        seen.add(name);
        out += `\n${expandPnpmScripts(scripts[name], scripts, seen)}`;
    }
    return out;
}

function stripHashComments(text) {
    return text.split('\n').map((line) => {
        const trimmed = line.trimStart();
        if (trimmed.startsWith('#!') || trimmed.startsWith('#')) return '';
        const at = line.search(/\s#\s/);
        return at >= 0 ? line.slice(0, at) : line;
    }).join('\n');
}

/** True for a module specifier position: import/export from, require(), import(), import.meta.glob(), new URL(x, import.meta.url). */
function isModuleSpecifier(node) {
    const parent = node.parent;
    if (!parent) return false;
    if ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node) return true;
    if (ts.isExternalModuleReference(parent)) return true;
    if (ts.isCallExpression(parent) && parent.arguments[0] === node) {
        const callee = parent.expression;
        if (callee.kind === ts.SyntaxKind.ImportKeyword) return true;
        if (ts.isIdentifier(callee) && callee.text === 'require') return true;
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'resolve' && ts.isIdentifier(callee.expression)
            && callee.expression.text === 'require') return true;
        if (ts.isPropertyAccessExpression(callee) && /^glob/.test(callee.name.text)) return true;
    }
    if (ts.isNewExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'URL'
        && parent.arguments?.[0] === node) return true;
    return false;
}

/**
 * The strings a file contains (comments ignored where the language allows it) and, for JavaScript and TypeScript,
 * which of them are module specifiers. Only module specifiers and named scripts extend the executed closure; every
 * string is still checked for references to the changed files.
 */
export function stringsOf(file, text) {
    if (CODE.test(file)) {
        const kind = /x$/.test(file) ? ts.ScriptKind.TSX : /\.[cm]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
        const values = [];
        const modules = [];
        const visit = (node) => {
            if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
                || ts.isJsxText(node)) {
                values.push(node.text);
                if (ts.isStringLiteralLike(node) && isModuleSpecifier(node)) modules.push(node.text);
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
        return { values, modules };
    }
    if (file.endsWith('.json')) {
        try {
            const values = [];
            const walk = (v) => {
                if (typeof v === 'string') values.push(v);
                else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { values.push(k); walk(x); }
            };
            walk(JSON.parse(text));
            return { values, modules: [] };
        } catch { /* fall through to text */ }
    }
    if (/\.(?:sh|bash|py|ya?ml|toml)$/.test(file) || !path.extname(file)) return { values: [stripHashComments(text)], modules: [] };
    return { values: [text], modules: [] };
}

function isText(root, file) {
    try {
        const buf = fs.readFileSync(path.join(root, file));
        return buf.length < 4 << 20 && !buf.subarray(0, 8000).includes(0);
    } catch { return false; }
}

/**
 * Resolve the paths a string may name, relative to the repository root and to the file that contains it.
 * Returns tracked files and tracked directories (as `dir/`), never anything outside the checkout.
 */
function resolveCandidates(value, fromFile, index) {
    const out = new Set();
    const tokens = new Set([value.trim(), ...(value.match(PATH_TOKEN) ?? [])]);
    for (const raw of tokens) {
        if (!raw || raw.length > 400 || /[\s*?{}$]/.test(raw)) continue;
        const bases = raw.startsWith('./') || raw.startsWith('../') ? [path.posix.dirname(fromFile)] : ['', path.posix.dirname(fromFile)];
        for (const base of bases) {
            const joined = path.posix.normalize(path.posix.join(base, raw.replace(/^\.\//, '')));
            if (joined.startsWith('../') || joined === '..') continue;
            const clean = joined.replace(/\/$/, '');
            for (const ext of RESOLVE_EXTENSIONS) {
                if (index.files.has(clean + ext)) { out.add(clean + ext); break; }
            }
            if (index.dirs.has(clean)) out.add(`${clean}/`);
        }
    }
    return out;
}

/**
 * @param {{ root: string, workflow: object, packageScripts: Record<string,string>, files: string[],
 *           read?: (file: string) => string }} input
 * @returns {{ entries: string[], closure: string[], references: Map<string, Set<string>>,
 *            markdownLiterals: Array<{file:string, literal:string}> }}
 */
export function scanSkippedSurfaces({ root, workflow, packageScripts, files, read }) {
    const readFile = read ?? ((file) => fs.readFileSync(path.join(root, file), 'utf8'));
    const index = { files: new Set(files), dirs: new Set() };
    for (const f of files) {
        const parts = f.split('/');
        for (let i = 1; i < parts.length; i++) index.dirs.add(parts.slice(0, i).join('/'));
    }
    const filesUnder = (dir) => files.filter((f) => f.startsWith(dir));

    const isExecutable = (f) => EXECUTABLE.test(f) && !TEST_FILE.test(f);
    const entries = new Set();
    // Test runners execute whole directories that no command names file by file.
    for (const dir of RUNNER_ROOTS) filesUnder(`${dir}/`).forEach((f) => entries.add(f));
    for (const { commands } of skippedSurfaces(workflow)) {
        for (const command of commands) {
            const text = expandPnpmScripts(stripHashComments(command), packageScripts);
            for (const token of [text, ...(text.match(PATH_TOKEN) ?? [])]) {
                for (const ref of resolveCandidates(token, '', index)) {
                    if (ref.endsWith('/')) filesUnder(ref).forEach((f) => entries.add(f));
                    else entries.add(ref);
                }
            }
        }
    }

    // references: referenced path (file or `dir/`) -> the executed files whose strings name it.
    const references = new Map();
    const markdownLiterals = [];
    const closure = new Set();
    const queue = [...entries];
    const loaded = new Set();
    const follow = (ref) => {
        if (ref.endsWith('/')) return;
        loaded.add(ref);
        if (!closure.has(ref)) queue.push(ref);
    };
    while (queue.length) {
        const file = queue.shift();
        if (closure.has(file)) continue;
        closure.add(file);
        if (MARKDOWN_FILE.test(file)) continue; // an executed Markdown file is itself a reference (below)
        // A static asset swept in with a runner root (an image, a vocabulary file, a vendored package manifest) is
        // copied or served, never run, so its strings name nothing that is read. Code, scripts and configuration
        // are readers wherever they come from; any other file is a reader when something executed loads it.
        if (!isExecutable(file) && !loaded.has(file)) continue;
        if (!isText(root, file)) continue;
        let text;
        try { text = readFile(file); } catch { continue; }
        const { values, modules } = stringsOf(file, text);
        // Modules this file loads are executed. Relative specifiers resolve against the file; the frontend's `@/`
        // alias resolves to frontend/src. Bare package names are third-party code outside the checkout.
        for (const specifier of modules) {
            const local = specifier.startsWith('@/') ? `frontend/src/${specifier.slice(2)}` : specifier;
            if (!local.startsWith('.') && !local.startsWith('frontend/src/')) continue;
            const refs = resolveCandidates(local.split('?')[0], local.startsWith('.') ? file : '', index);
            for (const ref of refs) {
                if (!references.has(ref)) references.set(ref, new Set());
                references.get(ref).add(file);
                follow(ref);
            }
        }
        for (const value of values) {
            for (const ref of resolveCandidates(value, file, index)) {
                if (!references.has(ref)) references.set(ref, new Set());
                references.get(ref).add(file);
                // A named script or config is executed; anything else a string names is data the file may read.
                if (isExecutable(ref)) follow(ref);
            }
            for (const literal of value.match(MARKDOWN_TOKEN) ?? []) markdownLiterals.push({ file, literal, text: value.trim() });
        }
    }
    for (const file of closure) {
        if (MARKDOWN_FILE.test(file)) {
            if (!references.has(file)) references.set(file, new Set());
            references.get(file).add('(executed surface)');
        }
    }
    return { entries: [...entries].sort(), closure: [...closure].sort(), references, markdownLiterals };
}

export const GUARD_HOLD = Object.freeze({
    NOT_DOCS_LANE: 'docs_guard_change_is_not_docs_lane_prose',
    REFERENCED: 'docs_guard_changed_file_read_by_skipped_surface',
    UNREVIEWED: 'docs_guard_unreviewed_markdown_reference_in_skipped_surface',
});

/**
 * @param {{ changedFiles: string[], scan: ReturnType<typeof scanSkippedSurfaces>, reviewed?: Record<string,string> }} input
 */
export function evaluateDocsLaneGuard({ changedFiles, scan, reviewed = REVIEWED_MARKDOWN_MENTIONS }) {
    const reasons = [];
    if (!Array.isArray(changedFiles) || changedFiles.length === 0 || !changedFiles.every(isDocsLaneFile)) {
        return { ok: false, reasons: [GUARD_HOLD.NOT_DOCS_LANE] };
    }
    for (const changed of changedFiles) {
        for (const [ref, by] of scan.references) {
            const hit = ref.endsWith('/') ? changed.startsWith(ref) : ref === changed;
            if (hit) reasons.push(`${GUARD_HOLD.REFERENCED}:${changed}<-${[...by].sort().slice(0, 3).join(',')}`);
        }
    }
    // Every Markdown name an executed file mentions, whether or not it exists at this commit (a deleted file does
    // not): a concrete name matches any changed path that ends with it, so a bare `README.md` or a computed suffix
    // such as `.human-worksheet.md` is matched conservatively. A pattern cannot be matched, so it must be reviewed.
    for (const { file, literal, text } of scan.markdownLiterals) {
        if (Object.hasOwn(reviewed, `${file}::${text}`)) continue;
        if (GLOB.test(literal)) {
            reasons.push(`${GUARD_HOLD.UNREVIEWED}:${file}::${literal}`);
            continue;
        }
        const tail = literal.replace(/^(?:\.{0,2}\/)+/, '');
        for (const changed of changedFiles) {
            if (changed === tail || changed.endsWith(tail.startsWith('.') ? tail : `/${tail}`)) {
                reasons.push(`${GUARD_HOLD.REFERENCED}:${changed}<-${file}`);
            }
        }
    }
    return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function runGuard(root, changedFiles) {
    const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    const packageScripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {};
    const scan = scanSkippedSurfaces({ root, workflow, packageScripts, files: trackedFiles(root) });
    return { scan, decision: evaluateDocsLaneGuard({ changedFiles, scan }) };
}

// ---- CLI ---------------------------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''));
if (isMain) {
    const [, , changedPath] = process.argv;
    let changedFiles = null;
    try {
        changedFiles = fs.readFileSync(changedPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
    } catch { /* reported as not docs lane */ }
    const { scan, decision } = runGuard(process.cwd(), changedFiles);
    console.log(`[docs-lane-guard] skipped-surface files=${scan.closure.length} entries=${scan.entries.length} markdown-names=${scan.markdownLiterals.length} changed=${changedFiles?.length ?? 0}`);
    if (!decision.ok) {
        for (const reason of decision.reasons.slice(0, 50)) console.log(`::error::${reason}`);
        process.exit(1);
    }
    console.log('[docs-lane-guard] no job skipped by the docs lane reads any changed file');
    const receipt = process.env.DOCS_LANE_RECEIPT;
    if (receipt) {
        const workflow = yaml.load(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
        const sha = (v) => (/^[0-9a-f]{40}$/.test(v ?? '') ? v : null);
        fs.writeFileSync(receipt, `${JSON.stringify({
            schemaVersion: 1,
            kind: 'docs-lane-evidence',
            repository: process.env.GITHUB_REPOSITORY ?? null,
            runId: process.env.GITHUB_RUN_ID ?? null,
            runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
            checkoutCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
            pullRequestHead: sha(process.env.PR_HEAD_SHA),
            base: sha(process.env.BASE_SHA),
            changedFiles,
            skippedJobs: skippedSurfaces(workflow).map((s) => s.job),
            skippedSurfaceFiles: scan.closure.length,
            reviewedMentions: Object.keys(REVIEWED_MARKDOWN_MENTIONS),
        }, null, 2)}\n`);
        console.log(`[docs-lane-guard] wrote ${receipt}`);
    }
}
