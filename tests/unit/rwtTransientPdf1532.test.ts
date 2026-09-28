// @vitest-environment node
/**
 * #1532 Codex P1 r4126003354 (PM RETURN 5876635920) — the Production transcript PDF must not be able to enter ANY
 * uploaded artifact, even when the run is killed after `saveAs` and before `finally`.
 *
 * Artifact inspection, not a string check: a fake workspace and a fake RUNNER_TEMP are populated as an interrupted
 * run leaves them (the PDF written, never removed), and every file each rc-gates.yml Gate 3 upload step would collect
 * is enumerated from that step's own `path:` entries. The PDF, and its transcript bytes, must be in none of them.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { transientPrivateDir } from '../live/helpers/rwtTransientFile';

const ROOT = resolve(__dirname, '../..');
const TRANSCRIPT = 'fixture transcript words that must never be published';

type Step = { name?: string; uses?: string; with?: { path?: string } };
const uploadSteps = (): Step[] => {
    const workflow = parse(readFileSync(join(ROOT, '.github/workflows/rc-gates.yml'), 'utf8'));
    return (workflow.jobs['gate-3-dast'].steps as Step[]).filter((s) => String(s.uses ?? '').startsWith('actions/upload-artifact'));
};

const walk = (p: string): string[] => {
    if (!existsSync(p)) return [];
    if (statSync(p).isFile()) return [p];
    return readdirSync(p).flatMap((entry) => walk(join(p, entry)));
};
const globToRegExp = (glob: string) => new RegExp(`^${glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);

/** Every file one upload step would collect, given the workspace and runner temp as the run left them. */
const collected = (step: Step, workspace: string, runnerTemp: string): string[] =>
    String(step.with?.path ?? '').split('\n').map((l) => l.trim()).filter(Boolean).flatMap((entry) => {
        const concrete = entry.replace('${{ runner.temp }}', runnerTemp);
        const absolute = concrete.startsWith('/') ? concrete : join(workspace, concrete);
        if (!absolute.includes('*')) return walk(absolute);
        const base = absolute.slice(0, absolute.lastIndexOf('/', absolute.indexOf('*')));
        const re = globToRegExp(relative(base, absolute));
        return walk(base).filter((f) => re.test(relative(base, f)));
    });

/** A workspace + RUNNER_TEMP populated like an interrupted RWT run: receipts, a worksheet, and a private PDF placed by `place`. */
const interruptedRun = (place: (workspace: string, runnerTemp: string) => string) => {
    const workspace = mkdtempSync(join(tmpdir(), 'rwt-ws-'));
    const runnerTemp = mkdtempSync(join(tmpdir(), 'rwt-runner-temp-'));
    mkdirSync(join(workspace, 'test-results/rwt'), { recursive: true });
    writeFileSync(join(workspace, 'test-results/rwt/rwt-open-mic-first-session.receipt.json'), '{"suite":"rwt-open-mic-first-session"}\n');
    writeFileSync(join(runnerTemp, 'gate-3-evidence-eligibility.json'), '{}\n');
    const pdf = place(workspace, runnerTemp);
    writeFileSync(pdf, `%PDF-1.7 ${TRANSCRIPT}`);   // saveAs completed; the process is killed before `finally`
    return { workspace, runnerTemp, pdf };
};

describe('the transient PDF cannot enter any uploaded artifact (interrupted after save)', () => {
    it('CONTROL — the inspector finds the PDF where the old code put it (test-results/deployed-live/…)', () => {
        const run = interruptedRun((workspace) => {
            const dir = join(workspace, 'test-results/deployed-live/rwt-open-mic-first-session-chromium');
            mkdirSync(dir, { recursive: true });
            return join(dir, 'rwt-session.pdf');   // = testInfo.outputPath('rwt-session.pdf') at ce14b0d39
        });
        const leaking = uploadSteps().filter((s) => collected(s, run.workspace, run.runnerTemp).includes(run.pdf)).map((s) => s.name);
        expect(leaking).toContain('Upload ineligible diagnostic Gate 3 artifacts');
    });

    it('FIXED — in Actions (RUNNER_TEMP set) the PDF lives in a per-run private dir that no upload step collects', () => {
        const run = interruptedRun((_workspace, runnerTemp) => transientPrivateDir('pdf', { RUNNER_TEMP: runnerTemp }).file('rwt-session.pdf'));
        expect(run.pdf.startsWith(run.runnerTemp)).toBe(true);
        const steps = uploadSteps();
        expect(steps.length).toBeGreaterThanOrEqual(5);
        for (const step of steps) {
            const files = collected(step, run.workspace, run.runnerTemp);
            expect({ step: step.name, collectsPdf: files.includes(run.pdf) }).toEqual({ step: step.name, collectsPdf: false });
            const leaked = files.filter((f) => readFileSync(f, 'utf8').includes(TRANSCRIPT));
            expect({ step: step.name, leaked }).toEqual({ step: step.name, leaked: [] });
        }
    });

    it('locally (no RUNNER_TEMP) it lives under the OS temp dir, outside the repository and its test-results', () => {
        const dir = transientPrivateDir('pdf', {});
        try {
            expect(dir.dir.startsWith(tmpdir())).toBe(true);
            expect(dir.dir.startsWith(ROOT)).toBe(false);
            expect(relative(ROOT, dir.dir).startsWith('..')).toBe(true);
        } finally {
            dir.remove();
        }
    });

    it('remove() deletes the directory with the file (the normal, non-interrupted path)', () => {
        const dir = transientPrivateDir('pdf', { RUNNER_TEMP: mkdtempSync(join(tmpdir(), 'rwt-runner-temp-')) });
        writeFileSync(dir.file('rwt-session.pdf'), `%PDF ${TRANSCRIPT}`);
        dir.remove();
        expect(existsSync(dir.dir)).toBe(false);
    });

    it('file() keeps the private file inside its directory (no path escape)', () => {
        const dir = transientPrivateDir('pdf', { RUNNER_TEMP: mkdtempSync(join(tmpdir(), 'rwt-runner-temp-')) });
        try {
            expect(dir.file('../../test-results/rwt-session.pdf')).toBe(join(dir.dir, 'rwt-session.pdf'));
        } finally {
            dir.remove();
        }
    });
});

describe('wiring — the Open Mic suite exports through the private dir and still proves the PDF carries the transcript', () => {
    const spec = readFileSync(join(ROOT, 'tests/live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');

    it('no Production file is written through testInfo.outputPath in any RWT suite', () => {
        for (const file of ['tests/live/rwt-open-mic-first-session.live.spec.ts', 'tests/live/rwt-focus-points-session.live.spec.ts',
            'tests/live/rwt-focus-points-partial.live.spec.ts', 'tests/live/rwt-products-navigation.live.spec.ts',
            'tests/live/helpers/rwtJourney.ts', 'tests/live/helpers/rwtFocusPointsJourney.ts']) {
            expect({ file, usesOutputPath: readFileSync(join(ROOT, file), 'utf8').includes('outputPath(') }).toEqual({ file, usesOutputPath: false });
        }
    });

    it('the PDF is saved into transientPrivateDir, removed in finally, and the transcript assertion is unchanged', () => {
        expect(spec).toMatch(/const transient = transientPrivateDir\('pdf'\);\s+const file = transient\.file\('rwt-session\.pdf'\);/);
        expect(spec).toMatch(/await download\.saveAs\(file\);/);
        expect(spec).toMatch(/\} finally \{\s+transient\.remove\(\);/);
        expect(spec).toContain("canonicalizeForLeakCheck(text).includes(transcriptCanonical)");
        expect(spec).toContain("'the exported PDF contains the saved session transcript'");
    });
});
