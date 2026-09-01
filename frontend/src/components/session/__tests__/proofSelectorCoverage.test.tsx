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
import { readFileSync } from 'node:fs';
import { render, screen, cleanup } from '../../../../tests/support/test-utils';
import { MicCard } from '../MicCard';
import { SessionDuringState } from '../SessionDuringState';
import { computeProgressVsBaseline } from '@/utils/progressVsBaseline';
import {
    PROOF_SESSION_SURFACE, PROOF_SELECTOR_EXEMPTIONS, RETIRED_TRANSCRIPT_IDS,
    RETIRED_COMBINED_CONTROL,
} from '../../../../../tests/helpers/micControls';

const PROOF_FILES = [
    'tests/live/three-session-retention-proof.live.spec.ts',
    'tests/live/helpers/benchmark-utils.ts',
    // The RELEASE journey gate. It was absent from this list and was therefore the one proof still
    // clicking the retired combined control — the guard closed the class everywhere it looked, and this
    // file was outside where it looked.
    'tests/live/private-recording-proof.live.spec.ts',
];

const progress = computeProgressVsBaseline([{ fillerCount: 34, durationSeconds: 600 }]);

/** Every testid the proof files actually drive, comments stripped so prose cannot register as usage. */
function selectorsUsedByProofs(): Set<string> {
    const source = PROOF_FILES.map((f) => readFileSync(f, 'utf8'))
        .map((s) => s.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n'))
        .join('\n');
    const used = new Set<string>();
    for (const m of source.matchAll(/getByTestId\('([a-zA-Z0-9_-]+)'\)|data-testid="([a-zA-Z0-9_-]+)"/g)) {
        used.add(m[1] ?? m[2]);
    }
    return used;
}

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
        const source = PROOF_FILES.map((f) => readFileSync(f, 'utf8'))
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

    it('CASUALTY: no proof DRIVES a retired control', () => {
        // The declared-selector test above cannot catch this: RETIRED ids are deliberately IN the
        // declared set so the render test below can assert they are gone from the product. That made
        // "declared" mean "known", not "allowed", and a proof clicking a retired control passed the
        // guard — which is exactly how the release journey gate kept clicking a combined toggle the
        // session overhaul had deleted, failing after signup, download and READY.
        // Scoped to the retired CONTROL, not to retired read-only ids. A retired transcript id may
        // legitimately appear as an `.or()` fallback when a helper serves specs whose pages render
        // different surfaces — reading a surface that turns out absent yields null and the primary
        // locator still answers. Driving a control that renders nowhere cannot degrade: the click has
        // no target, so the journey simply stops, which is the failure this guard exists for.
        const used = selectorsUsedByProofs();
        expect(used.size, 'the scan must not be vacuous').toBeGreaterThan(10);
        expect(used.has(RETIRED_COMBINED_CONTROL),
            `a proof drives the retired combined control '${RETIRED_COMBINED_CONTROL}'`).toBe(false);
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
