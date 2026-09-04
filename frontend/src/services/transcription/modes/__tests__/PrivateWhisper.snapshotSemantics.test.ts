/**
 * #1405s — a live SNAPSHOT replaces the draft; it is never appended to it.
 *
 * THE DEFECT. Moonshine's `transcribe()` returns the COMPLETE transcript so far — its own docstring
 * says "returns the current snapshot". The facade treated every live result as a newly decoded segment
 * and accumulated it, which duplicates text. Overlap trimming hid the simplest case (a pure extension
 * shares a boundary with what came before) but cannot help when a snapshot REVISES an earlier word:
 *
 *     "hello word"  +  "hello world again"  ->  "hello word hello world again"
 *
 * The user watches their own words multiply while speaking.
 *
 * The fix is a declared contract, not a name check: an engine says whether its live results are
 * snapshots, and anything that declares nothing keeps the incremental merge v2/v4 depend on.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// A global setup mocks this module for other suites. The merge is the behaviour under test here, so the
// REAL implementation is required — a mocked merge would prove nothing about duplication.
vi.unmock('@/services/transcription/modes/PrivateWhisper');
let mergeLiveProvisionalTranscript: (previous: string, next: string) => string;
beforeAll(async () => {
    const actual = await vi.importActual<typeof import('../PrivateWhisper')>('../PrivateWhisper');
    mergeLiveProvisionalTranscript = actual.mergeLiveProvisionalTranscript;
});

/** The exact emit path under test, isolated from the engine stack. */
function visiblePartialFor(
    kind: 'incremental' | 'snapshot',
    previous: string,
    next: string,
): string {
    return kind === 'snapshot' ? next : mergeLiveProvisionalTranscript(previous, next);
}

/** Feed a sequence of live results through the emit path and return what the user would see. */
function runLive(kind: 'incremental' | 'snapshot', results: string[]): string {
    let visible = '';
    for (const r of results) visible = visiblePartialFor(kind, visible, r);
    return visible;
}

describe('#1405s snapshot engines — the draft is replaced, never accumulated', () => {
    it('CASUALTY: an EXTENDING snapshot shows only the latest text', () => {
        expect(runLive('snapshot', ['hello world', 'hello world again'])).toBe('hello world again');
    });

    it('CASUALTY: an UNCHANGED snapshot is not duplicated', () => {
        expect(runLive('snapshot', ['hello world', 'hello world'])).toBe('hello world');
    });

    it('CASUALTY: a REVISING snapshot replaces rather than concatenating', () => {
        // The case overlap-trimming cannot rescue: no shared boundary, so the old code appended
        // everything and the user saw their words doubled.
        const visible = runLive('snapshot', ['hello word', 'hello world again']);
        expect(visible).toBe('hello world again');
        expect(visible).not.toMatch(/hello word hello/);
    });

    it('CASUALTY: a long snapshot sequence does not inflate', () => {
        const visible = runLive('snapshot', [
            'the',
            'the quick',
            'the quick brown',
            'the quick brown fox',
        ]);
        expect(visible).toBe('the quick brown fox');
        // Inflation is the symptom the user reports: the same word appearing again and again.
        expect(visible.split(/\s+/).filter((w) => w === 'the')).toHaveLength(1);
    });

    it('a snapshot that legitimately SHRINKS (engine revised downward) is honoured', () => {
        // The no-shrink invariant exists for incremental windows sliding forward. For a snapshot it
        // would pin text the engine has retracted, which is a different lie than duplication.
        expect(runLive('snapshot', ['hello world again', 'hello world'])).toBe('hello world');
    });
});

describe('#1405s incremental engines (v2/v4) are unchanged', () => {
    it('still accumulates successive segments into a growing draft', () => {
        // A realistic incremental sequence. NOTE: a single-word follow-up against a two-word draft is
        // REPLACED by the pre-existing heuristics, not accumulated — that behaviour predates this change
        // and is deliberately left alone, so the example here is one the incremental path actually grows.
        const visible = runLive('incremental', ['the quick brown', 'fox jumps over']);
        expect(visible).toContain('the quick brown');
        expect(visible).toContain('fox jumps over');
    });

    it('CASUALTY: incremental behaviour must NOT become replacement', () => {
        // If the snapshot path were applied to v2/v4, the live draft would collapse to the newest
        // window and the user would watch their transcript reset as they spoke.
        const visible = runLive('incremental', ['the quick brown', 'fox jumps']);
        expect(visible, 'earlier speech must survive for an incremental engine').toContain('the quick brown');
    });

    it('still trims a boundary overlap rather than duplicating it', () => {
        expect(mergeLiveProvisionalTranscript('hello world', 'world again')).toBe('hello world again');
    });
});

describe('#1405s the kind is DECLARED by the engine, not inferred from its name', () => {
    beforeEach(() => vi.resetModules());

    it('Moonshine declares itself a snapshot engine', async () => {
        const mod = await import('../../engines/MoonshineStreamingEngine');
        const Engine = mod.MoonshineStreamingEngine as unknown as new (...a: never[]) => { liveResultKind?: string };
        expect(Engine.prototype.liveResultKind ?? new Engine().liveResultKind).toBe('snapshot');
    });

    it('CASUALTY: an engine that declares nothing is treated as incremental', async () => {
        // The safe default. A new engine cannot silently acquire replacement semantics, and — the
        // direction that caused this defect — cannot silently inherit accumulation either, because a
        // snapshot engine must say so.
        const { PrivateSTT } = await import('../../engines/PrivateSTT');
        const facade = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() }) as unknown as
            { getLiveResultKind: () => string };
        expect(facade.getLiveResultKind()).toBe('incremental');
    });
});

/**
 * THE REAL EMIT PATH.
 *
 * The suites above exercise the merge in isolation, which is useful but insufficient: a mutant that
 * removed the snapshot branch from `emitProvisionalPartial` passed all of them, because they
 * re-implemented the branch instead of executing it. These drive the actual method on a real
 * PrivateWhisper and assert on what reaches `onTranscriptUpdate` — the text the user sees.
 */
describe('#1405s the REAL emitProvisionalPartial honours the declared kind', () => {
    type Emit = { transcript: { partial?: string; final?: string } };

    async function makeMode(liveResultKind: 'incremental' | 'snapshot' | undefined) {
        const actual = await vi.importActual<typeof import('../PrivateWhisper')>('../PrivateWhisper');
        const emits: Emit[] = [];
        const privateSTT = {
            getLiveResultKind: liveResultKind ? () => liveResultKind : undefined,
            init: vi.fn(async () => ({ isOk: true, data: undefined })),
            start: vi.fn(async () => {}), stop: vi.fn(async () => {}),
            transcribe: vi.fn(async () => ({ isOk: true, data: '' })),
            getTranscript: vi.fn(async () => ''),
        };
        // PrivateWhisper is the DEFAULT export.
        const mode = Object.create(actual.default.prototype) as Record<string, unknown>;
        mode.privateSTT = privateSTT;
        mode.onTranscriptUpdate = (u: Emit) => emits.push(u);
        // The method maintains the running draft itself, so the test never assigns it between emits —
        // doing so would hand the code the answer instead of observing it produce one.
        mode.liveProvisionalTranscript = '';
        mode.bestVisibleProvisionalTranscript = '';
        mode.isStopping = false;
        mode.serviceId = 'svc-test';
        mode.instanceId = 'run-test';
        mode.lastTranscriptEmitAtMs = 0;
        mode.firstProvisionalAtMs = null;
        return { mode, emits };
    }

    /** Drive the genuine method, mirroring how a live decode calls it. */
    function emit(mode: Record<string, unknown>, text: string) {
        const proto = Object.getPrototypeOf(mode) as {
            emitProvisionalPartial: (t: string, r: string) => void;
        };
        proto.emitProvisionalPartial.call(mode, text, 'test');
    }

    it('CASUALTY: a snapshot engine emits the LATEST snapshot, never an accumulation', async () => {
        const { mode, emits } = await makeMode('snapshot');
        emit(mode, 'hello word');
        emit(mode, 'hello world again');

        const visible = (emits[emits.length - 1]?.transcript.partial ?? '');
        expect(visible, 'the user must see only the latest snapshot').toBe('hello world again');
        expect(visible).not.toMatch(/hello word hello/);
    });

    it('CASUALTY: an incremental engine still accumulates through the real path', async () => {
        const { mode, emits } = await makeMode('incremental');
        emit(mode, 'the quick brown');
        emit(mode, 'fox jumps over');

        const visible = (emits[emits.length - 1]?.transcript.partial ?? '');
        expect(visible).toContain('the quick brown');
        expect(visible).toContain('fox jumps over');
    });

    it('an engine declaring nothing takes the incremental path', async () => {
        const { mode, emits } = await makeMode(undefined);
        emit(mode, 'the quick brown');
        emit(mode, 'fox jumps over');
        expect((emits[emits.length - 1]?.transcript.partial ?? '')).toContain('the quick brown');
    });
});

/**
 * #1405s RETURN — a retracted snapshot must not come back at SAVE time.
 *
 * THE DEFECT. Replacing only the live callback left `bestVisibleProvisionalTranscript` holding whichever
 * snapshot was LONGEST. Finalization prefers that value over a shorter final candidate, so a snapshot the
 * engine had already retracted could be restored and SAVED. The user watches the correct text appear,
 * then finds words they never said in the saved transcript — which is worse than the live duplication,
 * because it is the copy they keep.
 *
 * The scenario is the reviewed one: "hello world again" is superseded by "hello world", and the final
 * must be "hello world" in both the display and the save.
 */
describe('#1405s RETURN — finalization cannot resurrect a longer earlier snapshot', () => {
    type Emit = { transcript: { partial?: string; final?: string } };

    async function snapshotMode() {
        const actual = await vi.importActual<typeof import('../PrivateWhisper')>('../PrivateWhisper');
        const emits: Emit[] = [];
        const mode = Object.create(actual.default.prototype) as Record<string, unknown>;
        mode.privateSTT = { getLiveResultKind: () => 'snapshot' as const };
        mode.onTranscriptUpdate = (u: Emit) => emits.push(u);
        mode.liveProvisionalTranscript = '';
        mode.bestVisibleProvisionalTranscript = '';
        mode.isStopping = false;
        mode.serviceId = 'svc'; mode.instanceId = 'run';
        mode.lastTranscriptEmitAtMs = 0; mode.firstProvisionalAtMs = null;
        return { mode, emits };
    }
    const emit = (mode: Record<string, unknown>, text: string) => {
        const proto = Object.getPrototypeOf(mode) as { emitProvisionalPartial: (t: string, r: string) => void };
        proto.emitProvisionalPartial.call(mode, text, 'test');
    };

    it('CASUALTY: a retracted longer snapshot is not held as the best provisional', async () => {
        const { mode, emits } = await snapshotMode();
        emit(mode, 'hello world again');
        emit(mode, 'hello world');

        // What the user currently sees.
        expect(emits[emits.length - 1]?.transcript.partial).toBe('hello world');
        // And, critically, what finalization would reach for. Holding the longer earlier snapshot here
        // is what let it be restored over a correct shorter final.
        expect((mode as { bestVisibleProvisionalTranscript: string }).bestVisibleProvisionalTranscript,
            'the retracted snapshot must not survive as the best provisional').toBe('hello world');
    });

    it('CASUALTY: the best provisional cannot outgrow the latest snapshot at any point', async () => {
        const { mode } = await snapshotMode();
        for (const s of ['a b c d e', 'a b c', 'a b c d']) emit(mode, s);
        const best = (mode as { bestVisibleProvisionalTranscript: string }).bestVisibleProvisionalTranscript;
        expect(best, 'the newest snapshot is the whole truth, however short').toBe('a b c d');
    });

    it('POSITIVE CONTROL: an incremental engine still keeps its longest accumulated draft', async () => {
        // The "prefer longer" rule exists for sliding windows and must survive for v2/v4: there, an
        // earlier window really does hold speech the newest one does not.
        const actual = await vi.importActual<typeof import('../PrivateWhisper')>('../PrivateWhisper');
        const mode = Object.create(actual.default.prototype) as Record<string, unknown>;
        mode.privateSTT = { getLiveResultKind: () => 'incremental' as const };
        mode.onTranscriptUpdate = () => {};
        mode.liveProvisionalTranscript = '';
        mode.bestVisibleProvisionalTranscript = '';
        mode.isStopping = false;
        mode.serviceId = 'svc'; mode.instanceId = 'run';
        mode.lastTranscriptEmitAtMs = 0; mode.firstProvisionalAtMs = null;

        emit(mode, 'the quick brown fox');
        const best = (mode as { bestVisibleProvisionalTranscript: string }).bestVisibleProvisionalTranscript;
        expect(best).toContain('the quick brown fox');
    });
});
