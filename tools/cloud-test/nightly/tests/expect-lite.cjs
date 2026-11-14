'use strict';
// A small expect() over node:assert for the nightly suite's node:test files. It covers only the matchers those
// files use, so the tests read the same as the design's examples without pulling a test framework into the harness.
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const isObj = (v) => v !== null && typeof v === 'object';
function matches(actual, expected) {
    if (!isObj(expected))
        return Object.is(actual, expected);
    if (!isObj(actual))
        return false;
    if (Array.isArray(expected))
        return Array.isArray(actual) && actual.length === expected.length && expected.every((e, i) => matches(actual[i], e));
    return Object.keys(expected).every((k) => matches(actual[k], expected[k]));
}
function matchers(actual, negate) {
    const check = (ok, msg) => assert.ok(negate ? !ok : ok, negate ? `not ${msg}` : msg);
    const throws = (fn) => { try { fn(); return { threw: false }; } catch (e) { return { threw: true, error: e }; } };
    return {
        toBe: (e) => (negate ? assert.notStrictEqual(actual, e) : assert.strictEqual(actual, e)),
        toEqual: (e) => (negate ? assert.notDeepStrictEqual(actual, e) : assert.deepStrictEqual(actual, e)),
        toContain: (e) => check(actual.includes(e), `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(e)}`),
        toBeGreaterThan: (e) => check(actual > e, `expected ${actual} > ${e}`),
        toBeLessThan: (e) => check(actual < e, `expected ${actual} < ${e}`),
        toHaveLength: (n) => check(actual.length === n, `expected length ${n}, got ${actual.length}`),
        toMatchObject: (e) => check(matches(actual, e), `expected ${JSON.stringify(actual)} to match ${JSON.stringify(e)}`),
        toBeInstanceOf: (C) => check(actual instanceof C, `expected an instance of ${C.name}`),
        toHaveBeenCalledTimes: (n) => check(actual.calls === n, `expected ${n} calls, got ${actual.calls}`),
        toThrow: (C) => {
            const r = throws(actual);
            check(r.threw && (!C || r.error instanceof C), `expected a throw${C ? ` of ${C.name}` : ''}${r.threw ? `, got ${r.error}` : ''}`);
        },
    };
}
function expect(actual) {
    const m = matchers(actual, false);
    m.not = matchers(actual, true);
    m.resolves = {
        toMatchObject: async (e) => matchers(await actual, false).toMatchObject(e),
        toEqual: async (e) => matchers(await actual, false).toEqual(e),
    };
    m.rejects = {
        toBeInstanceOf: async (C) => {
            let err = null;
            try { await actual; } catch (e) { err = e; }
            assert.ok(err instanceof C, `expected a rejection of ${C.name}, got ${err}`);
        },
    };
    return m;
}
/** A counting stand-in for vi.fn. */
function fn(impl = () => undefined) {
    const f = (...a) => { f.calls += 1; return impl(...a); };
    f.calls = 0;
    return f;
}
module.exports = { describe, expect, fn, it };
