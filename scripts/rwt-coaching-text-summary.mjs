#!/usr/bin/env node
/**
 * PO 2026-10-07 — "print the suggestions in the github run results".
 *
 * Renders each `test-results/rwt/<suite>.coaching-text.json` written by a SYNTHETIC-voice RWT take as Markdown for
 * `$GITHUB_STEP_SUMMARY`: the two phrases the page showed, the two the session saved, and whether they match. A record
 * from any other fixture kind is refused here as well (defence in depth): a human take's coaching paraphrases a real
 * person's speech and must never reach a public run page.
 *
 * Usage: node scripts/rwt-coaching-text-summary.mjs <file...>   (prints Markdown on stdout)
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** One table cell: no pipes, no line breaks, no HTML, bounded. An empty phrase reads as an explicit absence. */
export function cell(value) {
    if (typeof value !== 'string' || value.trim() === '') return '_(none)_';
    const flat = value.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
    return flat.length > 400 ? `${flat.slice(0, 400)}…` : flat;
}

export function renderCoachingText(records) {
    const shown = records.filter((r) => r && r.fixtureKind === 'synthetic');
    if (shown.length === 0) return '';
    const lines = ['## AI suggestions produced in this run (synthetic-voice takes only)', ''];
    for (const r of shown) {
        lines.push(`### ${cell(r.suite)} — fixture \`${cell(r.fixture)}\``, '',
            '| | What went well | What to try next |', '|---|---|---|',
            `| Shown on the page | ${cell(r.shownWell)} | ${cell(r.shownNext)} |`,
            `| Saved on the session | ${cell(r.savedWell)} | ${cell(r.savedNext)} |`, '',
            `Shown matches saved: **${r.shownMatchesSaved === true ? 'yes' : 'no'}**`, '');
    }
    return `${lines.join('\n')}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const records = process.argv.slice(2).map((file) => {
        try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
    });
    process.stdout.write(renderCoachingText(records));
}
