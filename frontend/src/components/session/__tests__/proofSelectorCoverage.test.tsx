/* @vitest-environment jsdom */
// #1306 — STRUCTURAL GUARD: every selector the production proof uses must render on a real surface.
//
// WHY THIS EXISTS. Attempts 5, 6 and 7 each failed on the same defect class — the harness asserting
// against a surface it had never rendered — and each was found only by spending a production dispatch:
//   attempt 5: `session-start-stop-button`, rendered by nothing on any viewport
//   attempt 6: the assertion demanded committed text that is empty by design mid-recording
//   attempt 7: five ids belonging to `LiveTranscriptPanel`, which the product never mounts
// Every previous fix addressed the instance. This closes the class: it MOUNTS the real components and
// proves each contracted selector actually renders, in milliseconds, before any production run.
//
// The contract lives in tests/helpers/micControls.ts and is the SAME object the proof helpers import.
// A hand-copied list here would drift from the proof and become a fourth vacuous check.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Repo root: the directory owning pnpm-lock.yaml. */
const REPO_ROOT = (() => {
    let dir = dirname(new URL(import.meta.url).pathname);
    for (let i = 0; i < 12; i += 1) {
        try { if (statSync(join(dir, 'pnpm-lock.yaml')).isFile()) return dir; } catch { /* keep walking */ }
        dir = dirname(dir);
    }
    throw new Error('repo root not found');
})();
import { render, screen, cleanup } from '../../../../tests/support/test-utils';
import { MicCard } from '../MicCard';
import { SessionDuringState } from '../SessionDuringState';
import { computeProgressVsBaseline } from '@/utils/progressVsBaseline';
import {
    PROOF_SESSION_SURFACE, PROOF_SELECTOR_EXEMPTIONS, RETIRED_TRANSCRIPT_IDS,
    RETIRED_COMBINED_CONTROL,
} from '../../../../../tests/helpers/micControls';

/**
 * EVERY live spec and helper, discovered rather than listed.
 *
 * This was a hand-maintained list of three files, and the release journey gate was not on it — which
 * is exactly why it kept driving a control the session overhaul had deleted. A list that must be
 * remembered is a list that will be forgotten, so the set is now derived from the tree.
 */
/** The curated session-surface proofs whose EVERY selector must be contracted. */
const CONTRACTED_PROOF_FILES = [
    'tests/live/three-session-retention-proof.live.spec.ts',
    'tests/live/helpers/benchmark-utils.ts',
    'tests/live/private-recording-proof.live.spec.ts',
];

const PROOF_FILES = (() => {
    const dir = join(REPO_ROOT, 'tests', 'live');
    const out: string[] = [];
    const walk = (d: string) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const p = join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (/\.(ts|mts)$/.test(e.name)) out.push(p.slice(REPO_ROOT.length + 1));
        }
    };
    walk(dir);
    return out;
})();

/** Strip comments so a retirement NOTE explaining the ban never counts as a usage. */
const code = (src: string): string => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');

const progress = computeProgressVsBaseline([{ fillerCount: 34, durationSeconds: 600 }]);

/** Mount the during state and report which of `ids` actually rendered. */
function renderDuringAndCollect(ids: readonly string[]) {
    render(
        <SessionDuringState
            recorder={{ elapsedSeconds: 60, amplitudes: [0.4], recordedCount: 1, onStop: vi.fn() }}
            transcript={{ tokens: [{ text: 'So' }], words: 12, fillersPerMin: 1.2 }}
            progress={progress}
        />,
    );
    const found = new Map(ids.map((id) => [id, screen.queryAllByTestId(id).length]));
    cleanup();
    return found;
}

describe('#1306 proof selector coverage — the class-level guard', () => {
    it('every DURING selector in the contract renders in the real during state', () => {
        const found = renderDuringAndCollect(PROOF_SESSION_SURFACE.during);
        const missing = [...found].filter(([, n]) => n === 0).map(([id]) => id);
        // A non-empty array here means a production dispatch WOULD fail on that selector.
        expect(missing, `contracted selectors that do not render: ${missing.join(', ')}`).toEqual([]);
    });

    it('every BEFORE control renders in the model status the contract assigns it', () => {
        for (const [status, control] of Object.entries(PROOF_SESSION_SURFACE.before)) {
            render(<MicCard onStart={vi.fn()} onDownloadModel={vi.fn()} privateModelStatus={status} />);
            expect(screen.queryAllByTestId(control), `${status} must render ${control}`).toHaveLength(1);
            cleanup();
        }
    });

    it('NON-VACUITY: a selector that does not exist is REJECTED by the same check', () => {
        // Without this the guard could pass on an empty or unmatched iteration — the exact failure mode
        // that made three earlier checks green while the harness was broken.
        const found = renderDuringAndCollect([...PROOF_SESSION_SURFACE.during, 'totally-not-a-real-testid']);
        const missing = [...found].filter(([, n]) => n === 0).map(([id]) => id);
        expect(missing, 'the bogus selector must be detected as missing').toEqual(['totally-not-a-real-testid']);
    });

    it('NON-VACUITY: the contract is not empty and the mount really produces elements', () => {
        expect(PROOF_SESSION_SURFACE.during.length).toBeGreaterThan(5);
        expect(Object.keys(PROOF_SESSION_SURFACE.before).length).toBeGreaterThan(3);
        const found = renderDuringAndCollect(PROOF_SESSION_SURFACE.during);
        expect([...found.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(5);
    });

    it('EVERY literal testid the proof uses is contracted, exempted, or a named retired id', () => {
        // Closes the drift gap: a new literal selector added to the proof must be declared here, so it
        // cannot reach production unproven. Constants are covered by the contract check above; this
        // catches raw strings, which is how every previous instance entered the code.
        const source = CONTRACTED_PROOF_FILES.map((f) => readFileSync(f, 'utf8'))
            .map((t) => t.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n'))
            .join('\n');
        const used = new Set<string>();
        for (const m of source.matchAll(/getByTestId\('([a-zA-Z0-9_-]+)'\)|data-testid="([a-zA-Z0-9_-]+)"/g)) {
            used.add(m[1] ?? m[2]);
        }
        expect(used.size, 'the scan must not be vacuous').toBeGreaterThan(10);

        const declared = new Set<string>([
            ...PROOF_SESSION_SURFACE.during,
            ...Object.values(PROOF_SESSION_SURFACE.before),
            ...Object.keys(PROOF_SELECTOR_EXEMPTIONS),
            ...RETIRED_TRANSCRIPT_IDS,
            RETIRED_COMBINED_CONTROL,
        ]);
        const undeclared = [...used].filter((id) => !declared.has(id)).sort();
        expect(undeclared, `undeclared proof selectors — contract or exempt them: ${undeclared.join(', ')}`)
            .toEqual([]);
    });

    /**
     * Live specs that STILL drive the retired combined control, enumerated so the debt is visible and
     * BOUNDED rather than discovered one production dispatch at a time.
     *
     * Every one of these is broken the same way the release journey gate was: the session overhaul
     * deleted `session-start-stop-button`, so the click has no target and the run fails after setup.
     * They are benchmark and probe harnesses rather than the release path, so migrating them is its own
     * ticket — but the list may only ever SHRINK, and nothing outside it may use the control.
     *
     * A ledger is not closure, which is why no ACTIVE workflow or package script may invoke anything on
     * it: the superseded benchmark entrypoints were retired rather than ledgered. That separation is
     * asserted below.
     *
     * `private-cache` appears on neither side. It was migrated off the retired control, but it also
     * forces Transformers.js and disables WebGPU, so it can only ever describe a v2 cold/warm start —
     * under a config selecting Moonshine or distil it would report a cache verdict for a model the
     * session never ran. It was therefore removed from `live-release-matrix` entirely (#1263), and
     * cold/warm proof of the SELECTED candidate moves to #1390, where the real switch and the observed
     * identity make the verdict attributable. Neither ledgering nor a matrix lane would have fixed
     * that: the harness pins the very thing the proof is supposed to vary.
     */
    const KNOWN_BROKEN_LIVE_SPECS: readonly string[] = [
        'tests/live/analytics-live-native-probe.live.spec.ts',
        'tests/live/tester-b-private-native-stt.live.spec.ts',
        'tests/live/stt-accuracy-integration.live.spec.ts',
        'tests/live/benchmark-v4.live.spec.ts',
        'tests/live/benchmark-native.live.spec.ts',
        'tests/live/benchmark-cpu.live.spec.ts',
        'tests/live/analytics-journey.live.spec.ts',
        'tests/live/filler-source-comparison.live.spec.ts',
        'tests/live/driver-dependent/private-stt.live.spec.ts',
    ];

    it('CASUALTY: no NEW proof drives the retired control, and the broken set only shrinks', () => {
        const offenders = PROOF_FILES.filter((f) => {
            const body = code(readFileSync(join(REPO_ROOT, f), 'utf8'));
            return body.includes(RETIRED_COMBINED_CONTROL);
        });
        // Nothing outside the recorded set may drive it — that is the regression this blocks.
        expect(offenders.filter((f) => !KNOWN_BROKEN_LIVE_SPECS.includes(f)).sort()).toEqual([]);
        // And the recorded set may not grow: a fixed spec must be deleted from the list, so the debt
        // cannot quietly stay the same size while files are swapped in and out of it.
        expect(offenders.length).toBeLessThanOrEqual(KNOWN_BROKEN_LIVE_SPECS.length);
    });

    it('CASUALTY: no ACTIVE workflow or package script invokes a ledgered broken spec', () => {
        // The ledger records debt; it does not license running it. A workflow that still invokes a spec
        // recorded as broken produces evidence naming a model or a journey that did not actually run,
        // which is worse than producing none.
        // Workflows, the package manifest, AND shell wrappers. `run-v4-gates.sh` invoked broken
        // proofs directly, so a scan that stopped at YAML and package.json would have called the
        // separation clean while a wrapper still launched them.
        const shellWrappers = readdirSync(join(REPO_ROOT, 'scripts'))
            .filter((f) => /\.(sh|mjs|mts)$/.test(f))
            .map((f) => join('scripts', f));
        const entrypoints = [
            ...readdirSync(join(REPO_ROOT, '.github', 'workflows'))
                .filter((f) => /\.ya?ml$/.test(f))
                .map((f) => join('.github', 'workflows', f)),
            'package.json',
            ...shellWrappers,
        ];
        const offenders: string[] = [];
        for (const ep of entrypoints) {
            // Comments stripped: an explanation of WHY a lane is retired names the spec, and must not
            // read as an invocation of it.
            const body = code(readFileSync(join(REPO_ROOT, ep), 'utf8'));
            for (const spec of KNOWN_BROKEN_LIVE_SPECS) {
                // Only an actual RUN counts; naming a spec in an error message explaining the ban does not.
                if (new RegExp(`playwright test[^\n]*${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(body)) {
                    offenders.push(`${ep} :: ${spec}`);
                }
            }
        }
        expect(offenders.sort()).toEqual([]);
    });

    it('NON-VACUITY: the retired-control scan actually reads these files', () => {
        // Without this, an empty offender list would be indistinguishable from a scan that read nothing.
        expect(PROOF_FILES.length).toBeGreaterThan(10);
        const anyRetired = PROOF_FILES.some((f) => code(readFileSync(join(REPO_ROOT, f), 'utf8'))
            .includes(RETIRED_COMBINED_CONTROL));
        expect(anyRetired, 'the known-broken specs must still be detectable').toBe(true);
    });

    it('every exemption carries a real reason', () => {
        for (const [id, reason] of Object.entries(PROOF_SELECTOR_EXEMPTIONS)) {
            expect(typeof reason === 'string' && reason.length > 20, `${id} needs a justification`).toBe(true);
        }
    });

    it('no RETIRED id renders on the during surface', () => {
        const found = renderDuringAndCollect([...RETIRED_TRANSCRIPT_IDS, RETIRED_COMBINED_CONTROL]);
        const alive = [...found].filter(([, n]) => n > 0).map(([id]) => id);
        // If one comes back, delete its retired entry — leaving it would exempt a live selector.
        expect(alive, `retired ids that now render: ${alive.join(', ')}`).toEqual([]);
    });
});
