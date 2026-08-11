import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN, scanText } from '../../scripts/no-unaffiliated-domain-scan.mjs';

const BRAND = 'speak' + 'sharp';
const TLD = 'a' + 'i';
const forbidden = (dot = '.') => `${BRAND}${dot}${TLD}`;
const scanner = readFileSync('scripts/no-unaffiliated-domain-scan.mjs', 'utf8');
const workflow = readFileSync('.github/workflows/no-unaffiliated-domain.yml', 'utf8');
const hostedCheck = readFileSync('scripts/check-hosted-allowed-origin.mjs', 'utf8');

describe('#1260 unaffiliated-domain zero-reference scanner', () => {
  it('denies bare, mixed-case, www, subdomain, and email forms', () => {
    expect(scanText(`https://${forbidden()}`)).toHaveLength(1);
    expect(scanText(forbidden().toUpperCase())).toHaveLength(1);
    expect(scanText(`www.${forbidden()}`)).toHaveLength(1);
    expect(scanText(`preview.${forbidden()}`)).toHaveLength(1);
    expect(scanText(`tester@${forbidden()}`)).toHaveLength(1);
  });

  it('denies URL, HTML, regex, Unicode, and hex dot encodings', () => {
    for (const dot of [
      '%2e', '&#46;', '&#046;', '&#x2e;', '&#x02E;', '&period;', '\\.', '\\u002e', '\\u{2e}',
      '\\u{02e}', '\\x2e',
    ]) {
      expect(scanText(forbidden(dot)), `dot form ${dot}`).toHaveLength(1);
    }
  });

  it('denies the domain embedded in tracked path shapes', () => {
    expect(FORBIDDEN.test(`docs/${forbidden()}/notes.md`)).toBe(true);
    expect(FORBIDDEN.test(`fixtures/${forbidden()}-origin.txt`)).toBe(true);
  });

  it('allows the canonical host, reserved fixtures, and ordinary brand text', () => {
    expect(scanText('https://speaksharp-public.vercel.app')).toHaveLength(0);
    expect(scanText('https://app.example.com')).toHaveLength(0);
    expect(scanText('SpeakSharp Private Practice')).toHaveLength(0);
    expect(scanText(`${BRAND} ${TLD}`)).toHaveLength(0);
  });

  it('does not mistake unrelated HTML entities for a dot', () => {
    expect(scanText(`${BRAND}&#038;${TLD}`)).toHaveLength(0);
    expect(scanText(`${BRAND}&#460;${TLD}`)).toHaveLength(0);
  });

  it('scans tracked text, tracked paths, and symlink blobs on PRs and main', () => {
    expect(scanner).toContain("execFileSync('git', ['ls-files', '-z']");
    expect(scanner).toContain('FORBIDDEN.test(file)');
    expect(scanner).toContain('lstatSync(file).isSymbolicLink()');
    expect(scanner).toContain('readlinkSync(file)');
    expect(workflow).toMatch(/on:\s*\n\s+pull_request:/);
    expect(workflow).toContain('branches: [main]');
    expect(workflow).toContain('node scripts/no-unaffiliated-domain-scan.mjs');
  });

  it('offers a manual fail-closed hosted config check without emitting the secret value', () => {
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain('--fail-with-body --silent --show-error');
    expect(workflow).toContain('node scripts/check-hosted-allowed-origin.mjs');
    expect(hostedCheck).toContain("entry?.name === 'ALLOWED_ORIGIN'");
    expect(hostedCheck).toContain("typeof matches[0].value !== 'string'");
    expect(hostedCheck).toContain('scanText(matches[0].value)');
    expect(hostedCheck).not.toContain('console.log(matches[0].value)');
    expect(hostedCheck).not.toContain('console.error(matches[0].value)');

    const cleanValue = 'https://speaksharp-public.vercel.app,http://localhost:5174';
    const clean = spawnSync('node', ['scripts/check-hosted-allowed-origin.mjs'], {
      encoding: 'utf8',
      input: JSON.stringify([{ name: 'ALLOWED_ORIGIN', value: cleanValue }]),
    });
    expect(clean.status).toBe(0);
    expect(clean.stdout).not.toContain(cleanValue);

    const forbiddenValue = `https://${forbidden()}`;
    const rejected = spawnSync('node', ['scripts/check-hosted-allowed-origin.mjs'], {
      encoding: 'utf8',
      input: JSON.stringify([{ name: 'ALLOWED_ORIGIN', value: forbiddenValue }]),
    });
    expect(rejected.status).toBe(1);
    expect(`${rejected.stdout}${rejected.stderr}`).not.toContain(forbiddenValue);
  });
});
