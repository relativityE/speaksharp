// @vitest-environment node
//
// Tests for the shared source-text helper. It underpins three guards, so a false negative here silently
// weakens all of them — which is exactly what its first version did.
import { describe, expect, it } from 'vitest';
import { stripLineComment, executableLines, matchesInCode, stripComments } from './lib/source-text';

describe('stripLineComment — quoted strings are not comments', () => {
  it('does NOT eat a pipe that follows a # inside a quoted string', () => {
    // The regression that motivated this: the naive stripper turned this into `echo 'a`, the pipe vanished,
    // and a masked workflow step would have slipped past the pipefail guard entirely.
    const line = `          echo 'a # b' | tee out.txt`;
    expect(stripLineComment(line, 'hash')).toContain('| tee out.txt');
  });

  it('does not treat a URL fragment as a comment', () => {
    const line = `curl "https://example.com/a#frag" | tee out.txt`;
    expect(stripLineComment(line, 'hash')).toContain('| tee out.txt');
  });

  it('still strips a REAL trailing comment', () => {
    expect(stripLineComment('cmd | tee out.txt   # explain', 'hash').trim()).toBe('cmd | tee out.txt');
  });

  it('treats `a#b` as code, not a comment (no preceding whitespace)', () => {
    expect(stripLineComment('run-thing-a#b', 'hash')).toBe('run-thing-a#b');
  });

  it('handles double quotes and escapes', () => {
    const line = `printf "a \\" # still-string" | tee out.txt   # real comment`;
    const out = stripLineComment(line, 'hash');
    expect(out).toContain('| tee out.txt');
    expect(out).not.toContain('real comment');
  });

  it('slash style: a URL scheme is not a comment', () => {
    const line = `const u = "https://example.com/x"; // trailing`;
    const out = stripLineComment(line, 'slash');
    expect(out).toContain('https://example.com/x');
    expect(out).not.toContain('trailing');
  });

  it('slash style: // inside a string is not a comment', () => {
    expect(stripLineComment(`const s = "a // b"; call();`, 'slash')).toContain('call()');
  });
});

describe('block comments respect quoted strings', () => {
  it('does NOT remove a /* ... */ that lives inside a string literal', () => {
    // The regex version turned this into `const a = "x  y"` — deleting code from inside a string.
    const src = 'const a = "x /* not a comment */ y"; call();';
    const out = stripComments(src, 'slash');
    expect(out).toContain('/* not a comment */');
    expect(out).toContain('call()');
  });

  it('still removes a REAL block comment', () => {
    expect(stripComments('a(); /* gone */ b();', 'slash')).not.toContain('gone');
  });

  it('removes a multi-line block comment while preserving line numbering', () => {
    const src = ['a();', '/* one', '   two */', 'b();'].join('\n');
    const out = stripComments(src, 'slash');
    expect(out.split('\n')).toHaveLength(4);
    expect(out).not.toContain('two');
    expect(out).toContain('b()');
  });

  it('a block-comment opener inside a string does not swallow the rest of the file', () => {
    const src = ['const s = "/*";', 'const kept = 1;'].join('\n');
    expect(stripComments(src, 'slash')).toContain('kept');
  });
});

describe('executableLines', () => {
  it('drops whole-line comments but preserves line count', () => {
    const src = ['# a', 'cmd', '  # b', 'cmd2'].join('\n');
    const out = executableLines(src, 'hash');
    expect(out).toHaveLength(4);
    expect(out[0]).toBe('');
    expect(out[1]).toBe('cmd');
    expect(out[3]).toBe('cmd2');
  });

  it('removes JS block comments', () => {
    expect(executableLines('/* gone */ kept();', 'slash').join('')).toContain('kept()');
    expect(executableLines('/* set -o pipefail */ x', 'slash').join('')).not.toContain('pipefail');
  });
});

describe('heredocs — a documented limitation, deliberately in the SAFE direction', () => {
  // A `run:` block may contain `cat <<'EOF' ... EOF` whose body is not shell at all. Tracking heredoc state is
  // more machinery than a guard warrants, so the behaviour is PINNED here instead of silently assumed. What
  // matters is the DIRECTION of the error: both cases below fail CLOSED (a spurious red), never open (a missed
  // masked step). If that ever inverts, these tests break.
  const body = [
    "cat <<'EOF' > note.md",
    '# This is markdown, not a shell comment',
    'a | tee looks-like-a-pipe.txt',
    'EOF',
    'real_cmd | tee out.txt',
  ].join('\n');

  it('treats a heredoc body line as code, so a pipe inside it is still SEEN (false positive, not a miss)', () => {
    const out = stripComments(body, 'hash');
    expect(out).toContain('looks-like-a-pipe.txt');   // flagged spuriously -> CI red -> a human looks. Safe.
  });

  it('strips a markdown heading inside a heredoc as if it were a comment (harmless for this guard)', () => {
    expect(stripComments(body, 'hash')).not.toContain('This is markdown');
  });

  it('never hides a REAL masked pipe that follows a heredoc', () => {
    // The dangerous direction: heredoc handling must not swallow subsequent real code.
    expect(stripComments(body, 'hash')).toContain('real_cmd | tee out.txt');
  });
});

describe('matchesInCode', () => {
  it('is not satisfied by a mention in a comment', () => {
    expect(matchesInCode('# set -o pipefail is required\ncmd | tee x', 'hash', 'pipefail')).toBe(false);
    expect(matchesInCode('set -o pipefail\ncmd | tee x', 'hash', 'pipefail')).toBe(true);
  });
});
