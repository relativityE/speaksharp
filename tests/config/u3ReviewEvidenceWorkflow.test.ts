import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/1047-u3-cross-page.yml', 'utf8');

describe('#1047 U3 review-evidence authority', () => {
  it('fails before evidence unless checked-out HEAD is the exact supplied 40-character SHA', () => {
    const validation = workflow.indexOf('- name: Validate exact reviewed SHA');
    const build = workflow.indexOf('- name: Build production app');
    const evidence = workflow.indexOf('- name: Run U3 evidence matrix');

    expect(validation).toBeGreaterThan(-1);
    expect(validation).toBeLessThan(build);
    expect(validation).toBeLessThan(evidence);
    expect(workflow).toContain('^[0-9a-f]{40}$');
    expect(workflow).toContain('ACTUAL_SHA="$(git rev-parse HEAD)"');
    expect(workflow).toContain('test "$ACTUAL_SHA" = "$REVIEWED_SHA"');
  });

  it('uploads only explicit U3 screenshots plus a sanitized manifest under the exact contract name', () => {
    expect(workflow).toContain('tests/e2e/progress-cross-page.e2e.spec.ts');
    expect(workflow).toContain("find test-results/1047-u3-cross-page -maxdepth 1 -type f -name '*.png'");
    expect(workflow).toContain('No approved U3 screenshots were produced');
    expect(workflow).not.toContain("find test-results -name '*.png'");
    expect(workflow).toContain('evidence/manifest.json');
    expect(workflow).toContain('schema: "speaksharp.review-evidence.v1"');
    expect(workflow).toContain('name: pr${{ github.event.inputs.pr }}-${{ github.event.inputs.reviewed_sha }}-1047-u3-cross-page');
    expect(workflow).toContain('retention-days: 1');
  });
});
