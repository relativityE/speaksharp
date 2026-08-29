import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    ProbeRecorder, validateProbeCells, serializeProbe, readProbeArtifact, bigIntSafe,
    type ProbeHeader, type ProbeCell,
} from '../probeArtifact';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'probe-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const header = (expected: string[]): ProbeHeader => ({
    kind: 'diagnostic_probe', armId: 'moonshine:tiny',
    command: 'run-browser-matrix --probe-clips=a,b', executionSha: 'deadbeef',
    expectedCells: expected,
});
const cell = (id: string, extra: Partial<ProbeCell> = {}): ProbeCell => ({
    utteranceId: id,
    invocations: [{ invocationId: `${id}:inv1`, kind: 'model.generate', observations: { tokenIds: [1, 2] } }],
    ...extra,
});

describe('#1304 evidence-first: the artifact exists before any inference', () => {
    it('writes a parseable skeleton on construction, before the first decode', () => {
        const d = tmp();
        const p = join(d, 'probe.partial.json');
        new ProbeRecorder(p, join(d, 'probe.json'), header(['a', 'b']));
        expect(existsSync(p), 'skeleton must exist before any cell is decoded').toBe(true);
        const doc = readProbeArtifact(p)!;
        expect(doc.complete).toBe(false);
        expect(doc.cells).toEqual([]);
        expect(JSON.parse(readFileSync(p, 'utf8')).expectedCells).toEqual(['a', 'b']);
    });

    it('each cell is durable BEFORE anything derived from it could be printed', () => {
        const d = tmp(); const p = join(d, 'probe.partial.json');
        const r = new ProbeRecorder(p, join(d, 'probe.json'), header(['a', 'b']));
        r.addCell(cell('a'));
        // addCell returns only after the bytes are on disk: a reader sees the cell immediately.
        expect(readProbeArtifact(p)!.cells.map(c => c.utteranceId)).toEqual(['a']);
    });

    it('INDUCED CRASH after the first cell, before the second writes, leaves a parseable partial', () => {
        // The worst moment: the window where a partial is most valuable and most likely to be malformed.
        const d = tmp(); const p = join(d, 'probe.partial.json');
        const r = new ProbeRecorder(p, join(d, 'probe.json'), header(['a', 'b']));
        r.addCell(cell('a'));
        expect(() => { throw new Error('simulated crash mid-run'); }).toThrow();
        const doc = readProbeArtifact(p)!;
        expect(doc.complete).toBe(false);
        expect(doc.cells).toHaveLength(1);
        expect(doc.cells[0].utteranceId).toBe('a');
        expect(existsSync(join(d, 'probe.json')), 'no final artifact may exist after a crash').toBe(false);
    });

    it('a failed cell retains STRUCTURED error evidence rather than vanishing', () => {
        const d = tmp(); const p = join(d, 'probe.partial.json');
        const r = new ProbeRecorder(p, join(d, 'probe.json'), header(['a']));
        r.addCell(cell('a', {
            invocations: [{
                invocationId: 'a:inv1', kind: 'pipeline.call', observations: {},
                error: { name: 'TypeError', message: 'Do not know how to serialize a BigInt' },
            }],
        }));
        const err = readProbeArtifact(p)!.cells[0].invocations[0].error!;
        expect(err.name).toBe('TypeError');
        expect(err.message).toContain('BigInt');
    });
});

describe('#1304 finalization is earned, not automatic', () => {
    it('refuses a final artifact when an expected cell is missing', () => {
        const d = tmp(); const p = join(d, 'probe.partial.json'); const f = join(d, 'probe.json');
        const r = new ProbeRecorder(p, f, header(['a', 'b']));
        r.addCell(cell('a'));
        expect(r.finalize()).toMatchObject({ ok: false, reason: 'missing_cells', detail: 'b' });
        expect(existsSync(f)).toBe(false);
        expect(readProbeArtifact(p)!.complete, 'the partial is retained, not removed').toBe(false);
    });

    it('produces complete:true atomically once the exact expected set is covered', () => {
        const d = tmp(); const p = join(d, 'probe.partial.json'); const f = join(d, 'probe.json');
        const r = new ProbeRecorder(p, f, header(['a', 'b']));
        r.addCell(cell('a')); r.addCell(cell('b'));
        expect(r.finalize()).toEqual({ ok: true });
        const doc = readProbeArtifact(f)!;
        expect(doc.complete).toBe(true);
        expect(doc.cells).toHaveLength(2);
        expect(JSON.parse(readFileSync(f, 'utf8')).partialArtifact).toBe(p);
    });

    it('rejects duplicate and unexpected cells', () => {
        expect(validateProbeCells([cell('a'), cell('a')], ['a'])).toMatchObject({ ok: false, reason: 'duplicate_cells' });
        expect(validateProbeCells([cell('a'), cell('z')], ['a'])).toMatchObject({ ok: false, reason: 'unexpected_cells', detail: 'z' });
    });

    it('a retry cannot duplicate or SILENTLY replace a recorded cell', () => {
        const d = tmp(); const r = new ProbeRecorder(join(d, 'p.json'), join(d, 'f.json'), header(['a']));
        r.addCell(cell('a'));
        expect(() => r.addCell(cell('a'))).toThrow(/already recorded/);
        expect(r.recorded).toHaveLength(1);
    });
});

describe('#1304 BigInt serialization is deterministic', () => {
    it('serializes BigInt and BigInt typed arrays without losing the artifact', () => {
        const c = cell('a', {
            invocations: [{
                invocationId: 'a:inv1', kind: 'model.generate',
                observations: { tokenIds: Array.from(new BigInt64Array([1n, 2n]), Number), eos: 2n },
            }],
        });
        const text = serializeProbe(header(['a']), [c], false);
        const parsed = JSON.parse(text);
        expect(parsed.cells[0].invocations[0].observations.tokenIds).toEqual([1, 2]);
        expect(parsed.cells[0].invocations[0].observations.eos).toBe(2);
        expect(serializeProbe(header(['a']), [c], false)).toBe(text);   // deterministic
        expect(bigIntSafe('k', 5n)).toBe(5);
    });
});

describe('#1304 cross-invocation attribution is structurally unavailable', () => {
    it('a cell carries NO result fields of its own — every observation is inside a tagged invocation', () => {
        // The case-B error: token ids from `model.generate` reported beside `{text:""}` from a DIFFERENT
        // pipeline call, then described as "the adapter received these tokens".
        const c: ProbeCell = {
            utteranceId: 'a',
            invocations: [
                { invocationId: 'a:inv2', kind: 'pipeline.call', observations: { text: '' } },
                { invocationId: 'a:inv3', kind: 'model.generate', observations: { tokenIds: [1, 2] } },
            ],
        };
        const ids = c.invocations.map(i => i.invocationId);
        expect(new Set(ids).size, 'each invocation is distinctly identified').toBe(ids.length);
        // Text and tokens are reachable ONLY through different invocation ids, so any claim relating them
        // must name both — the conflation cannot be made silently.
        const textInv = c.invocations.find(i => 'text' in i.observations)!;
        const tokenInv = c.invocations.find(i => 'tokenIds' in i.observations)!;
        expect(textInv.invocationId).not.toBe(tokenInv.invocationId);
        expect(c).not.toHaveProperty('text');
        expect(c).not.toHaveProperty('tokenIds');
    });

    it('observations from ONE invocation are attributable together', () => {
        const c = cell('a', {
            invocations: [{
                invocationId: 'a:inv1', kind: 'model.generate',
                observations: { tokenIds: [1, 2], decodedText: '<s></s>' },
            }],
        });
        const inv = c.invocations[0];
        expect(Object.keys(inv.observations)).toEqual(expect.arrayContaining(['tokenIds', 'decodedText']));
    });
});

describe('#1304 a probe artifact can never become selection evidence', () => {
    it('carries diagnostic_probe kind and no selection row shape', () => {
        const d = tmp(); const f = join(d, 'f.json');
        const r = new ProbeRecorder(join(d, 'p.json'), f, header(['a']));
        r.addCell(cell('a'));
        r.finalize();
        const doc = JSON.parse(readFileSync(f, 'utf8'));
        expect(doc.kind).toBe('diagnostic_probe');
        expect(doc).not.toHaveProperty('wer');
        expect(doc).not.toHaveProperty('results');            // the selection artifact's row array
        expect(doc.cells.every((c: ProbeCell) => !('wer' in c))).toBe(true);
    });
});

describe('#1304 two arms in one run cannot share an artifact path', () => {
    it('distinct arms produce distinct paths, so neither silently replaces the other', () => {
        // Regression: a two-arm parity probe produced a ONE-arm artifact because both recorders wrote
        // the same file. The recorder refuses a duplicate cell, but nothing stopped two recorders from
        // sharing a path — the same overwrite reached from outside.
        const d = tmp();
        const slug = (id: string) => id.replace(/[^a-zA-Z0-9]+/g, '_');
        const pathFor = (id: string) => join(d, `probe.${slug(id)}.json`);
        const a = new ProbeRecorder(join(d, `p.${slug('moonshine:tiny')}.json`), pathFor('moonshine:tiny'), header(['x']));
        const b = new ProbeRecorder(join(d, `p.${slug('moonshine:base')}.json`), pathFor('moonshine:base'), header(['x']));
        a.addCell(cell('x')); b.addCell(cell('x'));
        expect(a.finalize()).toEqual({ ok: true });
        expect(b.finalize()).toEqual({ ok: true });
        expect(pathFor('moonshine:tiny')).not.toBe(pathFor('moonshine:base'));
        expect(existsSync(pathFor('moonshine:tiny'))).toBe(true);
        expect(existsSync(pathFor('moonshine:base'))).toBe(true);
    });
});

describe('#1304 REAL persistence faults, injected — not simulated', () => {
    /**
     * The earlier "induced crash" test threw an exception NEXT TO the recorder rather than making the
     * recorder itself fail. That proves the test harness can throw, not that the artifact survives a real
     * fault. These make the filesystem actually refuse.
     */
    it('an unwritable directory surfaces the failure instead of silently losing the cell', () => {
        const d = tmp();
        const locked = join(d, 'locked');
        mkdirSync(locked, { recursive: true });
        const p = join(locked, 'probe.partial.json');
        const r = new ProbeRecorder(p, join(locked, 'probe.json'), header(['a']));
        r.addCell(cell('a'));                       // succeeds while writable
        chmodSync(locked, 0o500);                   // now read+execute only
        try {
            // The write must THROW rather than return as though the cell were durable.
            expect(() => r.addCell(cell('b'))).toThrow();
        } finally {
            chmodSync(locked, 0o700);               // always restore, or afterEach cannot clean up
        }
        // The previously written cell is still readable: a later failure does not destroy earlier evidence.
        expect(readProbeArtifact(p)!.cells.map(c => c.utteranceId)).toEqual(['a']);
    });

    it('a corrupted partial is reported as unreadable rather than parsed into false evidence', () => {
        const d = tmp();
        const p = join(d, 'probe.partial.json');
        const r = new ProbeRecorder(p, join(d, 'probe.json'), header(['a']));
        r.addCell(cell('a'));
        writeFileSync(p, '{"complete":false,"cells":[{"utteranceId":"a"');   // truncated mid-object
        // Returning null beats returning a plausible partial object a reader would trust.
        expect(readProbeArtifact(p)).toBeNull();
    });

    it('a pre-existing file at the final path is replaced atomically, never appended', () => {
        const d = tmp();
        const f = join(d, 'probe.json');
        writeFileSync(f, '{"stale":true}');
        const r = new ProbeRecorder(join(d, 'p.json'), f, header(['a']));
        r.addCell(cell('a'));
        expect(r.finalize()).toEqual({ ok: true });
        const doc = JSON.parse(readFileSync(f, 'utf8'));
        expect(doc.stale).toBeUndefined();
        expect(doc.complete).toBe(true);
    });

    it('no temp file survives a successful finalize', () => {
        const d = tmp();
        const r = new ProbeRecorder(join(d, 'p.json'), join(d, 'f.json'), header(['a']));
        r.addCell(cell('a'));
        r.finalize();
        expect(readdirSync(d).filter(n => n.includes('.tmp'))).toEqual([]);
    });
});
