import { describe, expect, it } from 'vitest';
import { execFileSync as run } from 'node:child_process';
import { mkdtempSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * #1306 Stage B postflight gate — FALSIFICATION.
 *
 * The gate is the only thing standing between "the migration ran" and "the migration did what it claimed".
 * Asserting that it passes on a healthy database proves almost nothing; what matters is that every state it
 * exists to reject actually drives it to a NONZERO exit. A gate nobody has driven into a failing state is a
 * gate nobody has tested.
 *
 * It needs no live database to prove that. The gate asks a fixed set of catalog questions and compares each
 * answer against an expected literal, so stubbing `psql` on PATH exercises the REAL script — its real
 * queries, its real comparisons, its real exit code — against any catalog state we choose.
 */
const GATE = resolve(__dirname, '../../scripts/postflight-gate-1306.sh');
const DOUBLE = resolve(__dirname, '../support/fake-psql.sh');

/** Run the real gate with a stubbed psql. Returns { code, out }. */
const gate = (mode, fixture = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'gate1306-'));
    copyFileSync(DOUBLE, join(dir, 'psql'));
    chmodSync(join(dir, 'psql'), 0o755);
    try {
        const out = run('bash', [GATE, mode], {
            encoding: 'utf8',
            env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...fixture },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { code: 0, out };
    } catch (e) {
        return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
};

describe('#1306 Stage B gate — healthy states pass', () => {
    it('BEFORE passes when both v1 overloads are present and executable', () => {
        const r = gate('before');
        expect(r.code).toBe(0);
        expect(r.out).toContain('gate passed (mode=before)');
    });

    it('AFTER passes when v1 is entirely gone and v2 is intact', () => {
        const r = gate('after', { F_V1A_COUNT: '0', F_V1B_COUNT: '0', F_TOTAL_V1: '0' });
        expect(r.code).toBe(0);
        expect(r.out).toContain('gate passed (mode=after)');
    });
});

describe('#1306 Stage B gate — THE PREMISE (before)', () => {
    it('REJECTS applying when v1 is already absent — nothing to retire is not a success', () => {
        // Without this the run would apply, observe v1 absent afterwards, and report a success it did not
        // cause. This is the single most important assertion in the gate.
        const r = gate('before', { F_V1A_COUNT: '0', F_V1B_COUNT: '0', F_TOTAL_V1: '0' });
        expect(r.code).toBe(1);
        // The check NAME appears whether it passed or failed, so assert the FAIL line itself.
        expect(r.out.replace(/ +/g, ' ')).toContain('FAIL v1-A (transcript overload) present');
        expect(r.out.replace(/ +/g, ' ')).toContain('FAIL v1-B (metrics overload) present');
    });

    // Each overload is asserted SEPARATELY. A mutant that made the v1-A check tautological survived the
    // first version of this suite: the only fixture that removed v1-A removed v1-B too, so the rejection
    // came from v1-B and the v1-A assertion was never isolated. Both directions are now covered, and each
    // asserts the FAIL line for its own overload — the check's NAME appears in the output either way.
    it.each([
        ['v1-A gone, v1-B present', { F_V1A_COUNT: '0' }, 'FAIL v1-A (transcript overload) present'],
        ['v1-B gone, v1-A present', { F_V1B_COUNT: '0' }, 'FAIL v1-B (metrics overload) present'],
    ])('REJECTS a half-present premise: %s', (_label, mutation, failLine) => {
        const r = gate('before', mutation);
        expect(r.code).toBe(1);
        expect(r.out.replace(/ +/g, ' ')).toContain(failLine);
    });

    // BOTH overloads, BOTH roles, each isolated. The gate previously checked grants for v1-A only, so a
    // v1-B that was present but unreachable by its callers passed the premise: the run would proceed as
    // though it were retiring a live, reachable function. Each casualty must fail for ITS OWN named cause,
    // which is why every case asserts its specific FAIL line rather than just a nonzero exit.
    it.each([
        ['v1-A authenticated absent', { F_V1A_AUTH: 'f' }, 'FAIL v1-A executable by authenticated'],
        ['v1-A service_role absent',  { F_V1A_SVC: 'f' },  'FAIL v1-A executable by service_role'],
        ['v1-B authenticated absent', { F_V1B_AUTH: 'f' }, 'FAIL v1-B executable by authenticated'],
        ['v1-B service_role absent',  { F_V1B_SVC: 'f' },  'FAIL v1-B executable by service_role'],
    ])('REJECTS when v1 exists but is not executable: %s', (_label, mutation, failLine) => {
        const r = gate('before', mutation);
        expect(r.code).toBe(1);
        expect(r.out.replace(/ +/g, ' ')).toContain(failLine);
    });

    it('POSITIVE CONTROL: all four grant checks are actually evaluated, not merely declared', () => {
        // A check that is never reached cannot fail. Prove all four appear in a healthy run's output.
        const out = gate('before').out.replace(/ +/g, ' ');
        for (const line of [
            'OK v1-A executable by authenticated', 'OK v1-A executable by service_role',
            'OK v1-B executable by authenticated', 'OK v1-B executable by service_role',
        ]) expect(out).toContain(line);
    });
});

describe('#1306 Stage B gate — THE OUTCOME (after)', () => {
    const retired = { F_V1A_COUNT: '0', F_V1B_COUNT: '0', F_TOTAL_V1: '0' };

    it('REJECTS a silent no-op — the migration ran but v1 is still there', () => {
        expect(gate('after', { F_TOTAL_V1: '2' }).code).toBe(1);
    });

    it('REJECTS PARTIAL retirement — both named signatures gone, a third overload survives', () => {
        // The worst of both states: callers of the surviving arity keep working, so nothing looks broken,
        // while the retirement is reported complete. Only the any-arity count catches this.
        const r = gate('after', { ...retired, F_TOTAL_V1: '1' });
        expect(r.code).toBe(1);
        expect(r.out).toContain('zero complete_session overloads remain');
    });
});

describe('#1306 Stage B gate — the successor is untouched, in BOTH modes', () => {
    const retired = { F_V1A_COUNT: '0', F_V1B_COUNT: '0', F_TOTAL_V1: '0' };

    it.each([
        ['v2 signature dropped', { F_V2_COUNT: '0' }, 'v2 exact signature present'],
        ['v2 lost authenticated EXECUTE', { F_V2_AUTH: 'f' }, 'v2 executable by authenticated'],
        ['v2 lost service_role EXECUTE', { F_V2_SVC: 'f' }, 'v2 executable by service_role'],
        ['v2 GRANTED to anon', { F_V2_ANON: 't' }, 'v2 NOT executable by anon'],
        ['v2 GRANTED to PUBLIC', { F_V2_PUBLIC: '1' }, 'v2 carries no PUBLIC grant'],
        ['a second v2 overload appeared', { F_V2_OVERLOADS: '2' }, 'exactly one complete_session_v2 overload'],
    ])('AFTER rejects: %s', (_label, mutation, expectedLine) => {
        const r = gate('after', { ...retired, ...mutation });
        expect(r.code).toBe(1);
        expect(r.out).toContain(expectedLine);
    });

    it('BEFORE rejects a damaged successor too — so an unsafe apply never starts', () => {
        // Anon reaching the successor is a privilege defect regardless of which side of the apply we are
        // on. Catching it BEFORE means the migration is never applied on top of it.
        expect(gate('before', { F_V2_ANON: 't' }).code).toBe(1);
    });
});

describe('#1306 Stage B gate — refuses to run ambiguously', () => {
    it('rejects an unknown or missing mode instead of defaulting to one', () => {
        expect(gate('').code).toBe(2);
        expect(gate('verify').code).toBe(2);
    });
});
