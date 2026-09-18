import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * #1480 — ONE theme authority. The five Rev 2 §1 colour roles (signature, ink, money, status, neutral) are defined
 * once, in `frontend/src/index.css`, and mapped once, in `frontend/tailwind.config.js`. Everything else consumes the
 * named roles.
 *
 * The retired colours (teal and `#8b95a5`) and raw copies of the role hexes already exist in page code on `main`.
 * #1480's migration removes them page by page, so this guard is a RATCHET: a file may reduce its count, may never
 * raise it, and a file absent from the baseline must contain none. Counts are matching LINES per file, recorded on
 * `main@8e638c84`. When a migration commit removes occurrences, lower (or delete) that file's baseline entry in the
 * same commit.
 */

const ROOT = resolve(process.cwd());
const SRC = join(ROOT, 'frontend/src');
const TOKEN_AUTHORITY = 'frontend/src/index.css';

const ROLE_TOKENS: Record<string, string> = {
    '--brand-signature': '#ffb61f',
    '--brand-signature-text': '#8a5510',
    '--brand-signature-ground': '#fdf3e2',
    '--brand-signature-border': '#f0dcb8',
    '--brand-ink': '#1c2333',
    '--brand-ink-raised': '#262f42',
    '--brand-ink-hairline': '#3a4457',
    '--brand-ink-text': '#eef1f7',
    '--brand-ink-muted': '#9aa6bd',
    '--brand-money': '#5b21b6',
    '--brand-money-soft': '#6d28d9',
    '--brand-money-on-ink': '#c4b5fd',
    '--brand-status': '#146b4a',
    '--brand-neutral-page': '#ffffff',
    '--brand-neutral-band': '#f7f9fc',
    '--brand-neutral-border': '#dbe2ec',
    '--brand-neutral-border-soft': '#e6ebf2',
    '--brand-neutral-border-strong': '#c8d2e0',
    '--brand-neutral-heading': '#1c2333',
    '--brand-neutral-body': '#1f2733',
    '--brand-neutral-secondary': '#414b5c',
    '--brand-neutral-muted': '#6b7688',
    // Designer rulings, 15 Sep (#1480 comment 5685636195).
    '--brand-record': '#d92d20',
    '--brand-record-text': '#a1261c',
    '--brand-progress-bar': '#1f9d6b',
    '--brand-regression': '#a8321f',
    '--brand-error': '#b42318',
    '--brand-error-ground': '#fef3f2',
    '--brand-error-border': '#fda29b',
    '--brand-success-ground': '#ecfdf3',
    '--brand-success-border': '#a6f4c5',
    '--brand-surface-session': '#aeb9cd',
    '--brand-surface-session-text': '#232c3a',
    '--brand-metric-clarity': '#6d28d9',
    // Focus Points identity, app routes only (#1480 comment 5685776478).
    '--brand-focus': '#6d28d9',
    '--brand-focus-strong': '#5b21b6',
    '--brand-focus-ground': '#f5f0ff',
    '--brand-focus-border': '#e6dcfb',
};

const RETIRED_GREY = /#8b95a5/i;
const RETIRED_TEAL = /#0d7d74|#17a99b|#0a5f58|#1d4a45|#e6f4f2|\bteal-\d{2,3}\b/i;
// Focus Points violets retired by the Designer's contrast ruling (#7b5ce0 is 3.9:1 on white).
const RETIRED_FOCUS_VIOLET = /#7b5ce0|#6a4fd0/i;
// Raw copies of role values outside the authority. `#ffffff` is excluded: white is not a brand literal.
const ROLE_LITERAL = new RegExp(
    [...new Set(Object.values(ROLE_TOKENS))].filter((hex) => hex !== '#ffffff').join('|'),
    'i',
);

const BASELINE_RETIRED_GREY: Record<string, number> = {
};

const BASELINE_RETIRED_TEAL: Record<string, number> = {
};

const BASELINE_RETIRED_FOCUS_VIOLET: Record<string, number> = {
};

// Includes the Designer-ruling values added on 15 Sep (record, progress bar, regression, error/success states,
// session surface, clarity), recounted on the same `main@8e638c84` tree.
// Empty: no file outside the authority copies a role value. Both filler series moved to named tokens
// (#1480 follow-up), which retired the last entry here.
const BASELINE_ROLE_LITERALS: Record<string, number> = {
};

// Any raw hex literal. Six digits anywhere; three digits only after a quote, bracket, paren or colon, so issue
// references such as `#891` in comments are not counted. Recorded on `main@8e638c84`.
const RAW_HEX = /#[0-9a-fA-F]{6}\b|['"`[(:]\s*#[0-9a-fA-F]{3}\b/;
// Tailwind's built-in hue scales bypass the roles entirely (amber caution strips, emerald links, red alerts).
const PALETTE_UTILITY =
    /\b(?:text|bg|border|ring|from|to|via|fill|stroke|divide|outline|decoration|shadow|placeholder|accent|caret)-(?:teal|emerald|green|amber|yellow|orange|red|rose|pink|fuchsia|violet|purple|indigo|blue|sky|cyan|slate|gray|zinc|stone|lime)-\d{2,3}\b/;

const BASELINE_RAW_HEX: Record<string, number> = {
    'frontend/src/components/session/LiveTranscriptPanel.tsx': 2,
    'frontend/src/components/session/__tests__/FillerWordAnalysis.component.test.tsx': 15,
    'frontend/src/components/session/__tests__/LiveTranscriptPanel.component.test.tsx': 5,
    'frontend/src/components/session/__tests__/TranscriptPanel.component.test.tsx': 5,
    'frontend/src/hooks/__tests__/useSessionLifecycle.test.tsx': 1,
    'frontend/src/hooks/__tests__/useSessionMetrics.test.ts': 7,
    'frontend/src/hooks/useSessionLifecycle.ts': 1,
    'frontend/src/services/__tests__/SpeechRuntimeController.test.ts': 2,
    'frontend/src/services/transcription/__tests__/TranscriptionService.test.ts': 2,
    'frontend/src/services/transcription/__tests__/transcriptSanitizer.test.ts': 1,
    'frontend/src/services/transcription/modes/__tests__/PrivateWhisper.opening-capture.test.ts': 2,
    'frontend/src/services/transcription/modes/__tests__/PrivateWhisper.softonset-fixture.test.ts': 1,
    'frontend/src/services/transcription/modes/__tests__/PrivateWhisper.test.ts': 1,
    'frontend/src/services/transcription/modes/__tests__/helpers/wav.ts': 1,
    'frontend/src/services/transcription/utils/__tests__/frameReplayBuffer.test.ts': 1,
    'frontend/src/services/transcription/utils/frameReplayBuffer.ts': 1,
    'frontend/src/stores/__tests__/useSessionStore.test.ts': 6,
    'frontend/src/stores/useSessionStore.ts': 1,
    'frontend/src/utils/__tests__/fillerWordUtils.test.ts': 1,
    'frontend/src/utils/__tests__/finalizedSessionAnalysis.test.ts': 1,
    'frontend/src/utils/__tests__/sessionAnalysis.test.ts': 1,
    'frontend/src/utils/finalizedSessionAnalysis.ts': 2,
};

const BASELINE_PALETTE_UTILITY: Record<string, number> = {
    'frontend/src/components/landing/BenefitsSection.tsx': 1,
    'frontend/src/components/landing/CTASection.tsx': 1,
    'frontend/src/components/landing/FeaturesSection.tsx': 2,
    'frontend/src/components/landing/HeroSection.tsx': 4,
    'frontend/src/components/landing/HeroStatsDashboard.tsx': 7,
    'frontend/src/components/session/__tests__/StatusNotificationBar.test.tsx': 1,
    'frontend/src/lib/__tests__/utils.test.ts': 4,
};

const SCANNED = /\.(tsx?|jsx?|css)$/;

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
        else if (SCANNED.test(name)) out.push(relative(ROOT, path));
    }
    return out;
}

const matchingLines = (file: string, pattern: RegExp) =>
    readFileSync(join(ROOT, file), 'utf8').split('\n').filter((line) => pattern.test(line)).length;

function ratchetViolations(pattern: RegExp, baseline: Record<string, number>): string[] {
    return sourceFiles(SRC)
        .filter((file) => file !== TOKEN_AUTHORITY)
        .map((file) => ({ file, count: matchingLines(file, pattern), allowed: baseline[file] ?? 0 }))
        .filter(({ count, allowed }) => count > allowed)
        .map(({ file, count, allowed }) => `${file}: ${count} (allowed ${allowed})`);
}

describe('#1480 — one theme authority', () => {
    it('index.css defines every Rev 2 §1 role token exactly once with its approved value', () => {
        const css = readFileSync(join(ROOT, TOKEN_AUTHORITY), 'utf8');
        const defined = Object.fromEntries(Object.keys(ROLE_TOKENS).map((token) => [
            token,
            [...css.matchAll(new RegExp(`${token}:\\s*([^;]+);`, 'g'))].map((match) => match[1].trim().toLowerCase()),
        ]));
        const expected = Object.fromEntries(Object.entries(ROLE_TOKENS).map(([token, value]) => [token, [value]]));
        expect(defined).toEqual(expected);
    });

    it('tailwind maps the five roles to the shared tokens rather than to literals', () => {
        const config = readFileSync(join(ROOT, 'frontend/tailwind.config.js'), 'utf8');
        const unmapped = Object.keys(ROLE_TOKENS).filter((token) => !config.includes(`var(${token})`));
        const leakedLiterals = [...new Set(Object.values(ROLE_TOKENS))]
            .filter((value) => value !== '#ffffff')
            .filter((value) => config.toLowerCase().includes(value));
        expect({ unmapped, leakedLiterals }).toEqual({ unmapped: [], leakedLiterals: [] });
    });
});

// shadcn HSL channel tokens are the brand roles in channel form (kept for Tailwind opacity modifiers). Each one must
// convert back to exactly its role's hex, so a channel value can never become an independent colour choice.
const CHANNEL_ROLES: Record<string, string> = {
    '--background': '--brand-surface-session',
    '--foreground': '--brand-neutral-body',
    '--card': '--brand-neutral-page',
    '--card-foreground': '--brand-neutral-body',
    '--popover': '--brand-neutral-page',
    '--popover-foreground': '--brand-neutral-body',
    '--primary': '--brand-signature',
    '--primary-foreground': '--brand-ink',
    '--secondary': '--brand-neutral-band',
    '--secondary-foreground': '--brand-neutral-body',
    '--muted': '--brand-neutral-band',
    '--muted-foreground': '--brand-surface-session-text',
    '--accent': '--brand-neutral-band',
    '--accent-foreground': '--brand-neutral-heading',
    '--destructive': '--brand-error',
    '--destructive-foreground': '--brand-neutral-page',
    '--success': '--brand-status',
    '--success-foreground': '--brand-neutral-page',
    '--border': '--brand-neutral-border',
    '--border-strong': '--brand-neutral-border-strong',
    '--input': '--brand-neutral-border-strong',
    '--ring': '--brand-signature-text',
    '--sidebar-background': '--brand-neutral-page',
    '--sidebar-foreground': '--brand-neutral-body',
    '--sidebar-primary': '--brand-signature',
    '--sidebar-primary-foreground': '--brand-ink',
    '--sidebar-accent': '--brand-neutral-band',
    '--sidebar-accent-foreground': '--brand-neutral-heading',
    '--sidebar-border': '--brand-neutral-border',
    '--sidebar-ring': '--brand-signature-text',
    '--chart-1': '--brand-signature',
    '--chart-2': '--brand-metric-clarity',
    '--chart-3': '--brand-status',
    '--chart-4': '--brand-ink-hairline',
    '--chart-5': '--brand-error',
    '--nav-active-bg': '--brand-signature-border',
    '--nav-active-fg': '--brand-signature-text',
    '--nav-item-fg': '--brand-neutral-secondary',
    '--nav-item-fg-hover': '--brand-neutral-heading',
    '--nav-avatar-bg': '--brand-neutral-border-soft',
    '--nav-avatar-fg': '--brand-neutral-secondary',
    '--session-warm-tile': '--brand-signature-ground',
    '--session-warm-tile-text': '--brand-signature-text',
};

function channelToHex(channel: string): string {
    const match = channel.match(/^([\d.]+) ([\d.]+)% ([\d.]+)%$/);
    if (!match) return `unparsed(${channel})`;
    const [h, s, l] = [Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100];
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return `#${[0, 8, 4].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, '0')).join('')}`;
}

describe('#1480 — shadcn channel tokens are the brand roles, never independent colours', () => {
    it('every light-theme channel token converts back to exactly its brand role', () => {
        const css = readFileSync(join(ROOT, TOKEN_AUTHORITY), 'utf8');
        const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('.dark {'));
        const firstValue = (token: string) => rootBlock.match(new RegExp(`\\n\\s*${token}:\\s*([^;]+);`))?.[1].trim() ?? 'missing';
        const actual = Object.fromEntries(Object.keys(CHANNEL_ROLES).map((token) => [token, channelToHex(firstValue(token))]));
        const expected = Object.fromEntries(Object.entries(CHANNEL_ROLES).map(([token, role]) => [token, ROLE_TOKENS[role]]));
        expect(actual).toEqual(expected);
    });

    it('CASUALTY: a drifted channel value is detected', () => {
        expect(channelToHex('40.4 100% 56.1%')).toBe(ROLE_TOKENS['--brand-signature']);
        expect(channelToHex('36 92% 40%')).not.toBe(ROLE_TOKENS['--brand-signature']);
    });
});

describe('#1480 — retired colours and raw palette literals only ratchet down', () => {
    it('no file adds the retired #8b95a5 grey (3.03:1 contrast)', () => {
        expect(ratchetViolations(RETIRED_GREY, BASELINE_RETIRED_GREY)).toEqual([]);
    });

    it('no file adds retired teal', () => {
        expect(ratchetViolations(RETIRED_TEAL, BASELINE_RETIRED_TEAL)).toEqual([]);
    });

    it('no file adds the retired Focus Points violets (#7b5ce0 fails 4.5:1)', () => {
        expect(ratchetViolations(RETIRED_FOCUS_VIOLET, BASELINE_RETIRED_FOCUS_VIOLET)).toEqual([]);
    });

    it('no file adds a raw copy of a role value outside the token authority', () => {
        expect(ratchetViolations(ROLE_LITERAL, BASELINE_ROLE_LITERALS)).toEqual([]);
    });

    it('no file adds a raw hex literal', () => {
        expect(ratchetViolations(RAW_HEX, BASELINE_RAW_HEX)).toEqual([]);
    });

    it('no file adds a built-in Tailwind hue utility', () => {
        expect(ratchetViolations(PALETTE_UTILITY, BASELINE_PALETTE_UTILITY)).toEqual([]);
    });

    it('CASUALTY: the ratchet flags an added occurrence in a file that has no baseline', () => {
        expect(ratchetViolations(/./, {}).length).toBeGreaterThan(0);
    });
});
