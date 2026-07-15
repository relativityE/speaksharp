import { describe, it, expect } from 'vitest';
import { cvssBaseScore, scoreToRating, severityOf } from '../../scripts/lib/sca-severity.mjs';
import { parseOsvJson, evaluateOsv, ignoreSetFromPkg } from '../../scripts/lib/sca-gate.mjs';

const VITEST_GHSA = 'GHSA-5xrq-8626-4rwp';

const osv = (packages) => ({ results: [{ packages }] });
const pkg = (name, version, vulnerabilities) => ({ package: { name, version }, vulnerabilities });
const ghsaVuln = (id, severity = 'CRITICAL', aliases = []) => ({ id, aliases, database_specific: { severity } });
const vectorVuln = (id, vector) => ({ id, aliases: [], severity: [{ type: 'CVSS_V3', score: vector }] });

describe('CVSS v3.1 base-score parser (proven against official scores)', () => {
  it('computes the canonical 9.8 critical vector', () => {
    expect(cvssBaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8);
  });
  it('computes a scope-changed 10.0 critical vector', () => {
    expect(cvssBaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H')).toBe(10.0);
  });
  it('computes a low-severity vector', () => {
    const s = cvssBaseScore('CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N');
    expect(s).toBeGreaterThan(0);
    expect(scoreToRating(s)).toBe('LOW');
  });
  it('returns null for a non-CVSS-v3 string', () => {
    expect(cvssBaseScore('not-a-vector')).toBeNull();
    expect(cvssBaseScore('CVSS:2.0/AV:N')).toBeNull();
    expect(cvssBaseScore(undefined)).toBeNull();
  });
  it('maps scores to ratings at the official boundaries', () => {
    expect(scoreToRating(9.0)).toBe('CRITICAL');
    expect(scoreToRating(7.0)).toBe('HIGH');
    expect(scoreToRating(4.0)).toBe('MODERATE');
    expect(scoreToRating(0.1)).toBe('LOW');
    expect(scoreToRating(null)).toBe('UNKNOWN');
  });
});

describe('severityOf', () => {
  it('prefers the explicit GHSA rating', () => {
    expect(severityOf(ghsaVuln('GHSA-x', 'CRITICAL'))).toBe('CRITICAL');
    expect(severityOf(ghsaVuln('GHSA-x', 'MEDIUM'))).toBe('MODERATE');
  });
  it('classifies a vector-only advisory (no database_specific.severity)', () => {
    expect(severityOf(vectorVuln('CVE-1', 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'))).toBe('CRITICAL');
  });
  it('returns UNKNOWN when severity cannot be determined', () => {
    expect(severityOf({ id: 'X', aliases: [] })).toBe('UNKNOWN');
    expect(severityOf({ id: 'X', severity: [{ type: 'CVSS_V3', score: 'garbage' }] })).toBe('UNKNOWN');
  });
});

describe('evaluateOsv gate decision', () => {
  it('CASE vector-only critical: blocks', () => {
    const r = evaluateOsv(osv([pkg('foo', '1.0.0', [vectorVuln('CVE-9', 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')])]));
    expect(r.blocking).toHaveLength(1);
    expect(r.pass).toBe(false);
  });
  it('CASE duplicate paths: same advisory via two packages counts once', () => {
    const v = ghsaVuln(VITEST_GHSA, 'CRITICAL');
    const r = evaluateOsv(osv([pkg('vitest', '3.2.4', [v]), pkg('@vitest/coverage-v8', '4.1.9', [v])]));
    expect(r.distinct).toHaveLength(1);
    expect(r.distinct[0].paths).toBe(2);
  });
  it('CASE ignored GHSA: passes', () => {
    const r = evaluateOsv(osv([pkg('vitest', '3.2.4', [ghsaVuln(VITEST_GHSA, 'CRITICAL')])]), new Set([VITEST_GHSA.toUpperCase()]));
    expect(r.distinct).toHaveLength(1);
    expect(r.blocking).toHaveLength(0);
    expect(r.pass).toBe(true);
  });
  it('CASE unignored critical: fails', () => {
    const r = evaluateOsv(osv([pkg('bad', '2.0.0', [ghsaVuln('GHSA-real-crit', 'CRITICAL')])]), new Set([VITEST_GHSA.toUpperCase()]));
    expect(r.blocking).toHaveLength(1);
    expect(r.pass).toBe(false);
  });
  it('CASE UNKNOWN severity does not silently pass (fail-safe)', () => {
    const r = evaluateOsv(osv([pkg('mystery', '0.1.0', [{ id: 'UNCLASSIFIED', aliases: [] }])]));
    expect(r.histogram.UNKNOWN).toBe(1);
    expect(r.blocking).toHaveLength(1);
    expect(r.pass).toBe(false);
  });
  it('high/moderate/low advisories do not block', () => {
    const r = evaluateOsv(osv([pkg('h', '1', [ghsaVuln('GHSA-h', 'HIGH')]), pkg('m', '1', [ghsaVuln('GHSA-m', 'MODERATE')])]));
    expect(r.pass).toBe(true);
    expect(r.blocking).toHaveLength(0);
  });
});

describe('parseOsvJson (scanner-failure / invalid-input handling)', () => {
  it('CASE invalid JSON: throws (fail-closed)', () => {
    expect(() => parseOsvJson('{ not json')).toThrow(/invalid osv-scanner JSON/);
  });
  it('CASE scanner failure / empty output: throws (fail-closed)', () => {
    expect(() => parseOsvJson('')).toThrow(/empty osv-scanner output/);
    expect(() => parseOsvJson('   ')).toThrow(/empty osv-scanner output/);
  });
  it('rejects an unexpected shape', () => {
    expect(() => parseOsvJson('{"foo":1}')).toThrow(/unexpected osv-scanner JSON shape/);
  });
  it('accepts a valid results envelope', () => {
    expect(parseOsvJson('{"results":[]}')).toEqual({ results: [] });
  });
});

describe('ignoreSetFromPkg (single-source policy)', () => {
  it('reads pnpm.auditConfig.ignoreGhsas, uppercased', () => {
    const s = ignoreSetFromPkg({ pnpm: { auditConfig: { ignoreGhsas: ['ghsa-5xrq-8626-4rwp'] } } });
    expect(s.has('GHSA-5XRQ-8626-4RWP')).toBe(true);
  });
  it('is empty when absent', () => {
    expect(ignoreSetFromPkg({}).size).toBe(0);
  });
});
