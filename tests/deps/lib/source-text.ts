/**
 * Shared source-text helpers for assertions that read code as text.
 *
 * WHY THIS EXISTS. Repeatedly in #1314 an assertion matched DOCUMENTATION instead of behaviour:
 *   1. a "the release is not define-inlined" check matched the comment explaining that very rule;
 *   2. the workflow pipefail guard checked `body.includes('pipefail')`, so the step whose comment explains why
 *      pipefail is required exempted itself;
 *   3. a regex line-stripper turned `echo 'a # b' | tee out.txt` into `echo 'a`, deleting the pipe and hiding
 *      a masked step from the guard built to catch it;
 *   4. a regex block-stripper turned `const a = "x /* not a comment *\/ y"` into `const a = "x  y"`.
 * Every one was found by mutation or reproduction, not review. So this is ONE quote-aware scanner rather than a
 * pile of regexes, and it is tested directly in tests/deps/source-text.test.ts.
 *
 * LIMITS, stated rather than hidden. It is a lexer-lite for GUARDS, not a parser:
 *   - JS template-literal `${...}` interpolation is treated as ordinary string content;
 *   - a `/` that begins a regex literal containing `//` or quotes may confuse it;
 *   - YAML block scalars are treated as shell/JS text.
 * Where those matter, assert on something narrower instead of widening this.
 */

export type CommentStyle = 'hash' | 'slash';

/**
 * Remove comments from a whole source, respecting quoted strings, in a single pass.
 *
 * Newlines are preserved (including inside removed block comments) so line numbers remain meaningful to a
 * caller that indexes the result.
 */
export function stripComments(source: string, style: CommentStyle): string {
  let out = '';
  let quote: string | null = null;   // "'" | '"' | '`' when inside a string
  let inBlock = false;               // inside /* ... */  (slash style only)
  let inLine = false;                // inside a trailing // or # comment

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (inBlock) {
      if (ch === '\n') out += '\n';                    // keep line numbering
      if (ch === '*' && next === '/') { inBlock = false; i++; }
      continue;
    }
    if (inLine) {
      if (ch === '\n') { inLine = false; out += '\n'; }
      continue;
    }
    if (quote) {
      out += ch;
      if (ch === '\\' && quote !== "'") { if (next !== undefined) { out += next; i++; } continue; }
      if (ch === quote) quote = null;
      continue;
    }

    // Not in a string or comment.
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; out += ch; continue; }

    if (style === 'slash') {
      if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
      // `//` is a comment unless it is a URL scheme separator (`https://`).
      if (ch === '/' && next === '/' && source[i - 1] !== ':') { inLine = true; i++; continue; }
    } else if (ch === '#') {
      // A shell/YAML comment starts at line start or after whitespace; `a#b` is code.
      const prev = source[i - 1];
      if (prev === undefined || prev === '\n' || /\s/.test(prev)) { inLine = true; continue; }
    }

    out += ch;
  }
  return out;
}

/** Strip only the trailing comment from ONE line, respecting quoted strings. */
export function stripLineComment(line: string, style: CommentStyle): string {
  return stripComments(line, style);
}

/** Kept for callers that only need block removal; now quote-aware via the shared scanner. */
export function stripBlockComments(source: string, style: CommentStyle): string {
  return style === 'slash' ? stripComments(source, 'slash') : source;
}

/**
 * The lines that actually execute. Blank lines are preserved so line numbers stay meaningful.
 */
export function executableLines(source: string, style: CommentStyle): string[] {
  return stripComments(source, style).split('\n');
}

/** Convenience: the executable text as one string. */
export function executableText(source: string, style: CommentStyle): string {
  return stripComments(source, style);
}

/**
 * True when `pattern` appears in code rather than only in comments.
 * Prefer this over `source.includes(...)` for every "the code does X" assertion.
 */
export function matchesInCode(source: string, style: CommentStyle, pattern: RegExp | string): boolean {
  const text = executableText(source, style);
  return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
}
