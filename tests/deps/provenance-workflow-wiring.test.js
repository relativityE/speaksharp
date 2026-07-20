import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Enforces that EVERY inventoried data-producing workflow actually wires server-assigned provenance:
// registers before its product writes, expires in an always() cleanup, and shares ONE concurrency group
// so concurrent runs on the shared PRO_TEST account cannot overwrite each other's test_run_id.
const WF = resolve(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows');
const read = (f) => readFileSync(resolve(WF, f), 'utf8');

// The inventory (see telemetry-worker/RUNBOOK.md). Every workflow that can write a session/report.
const DATA_PRODUCING = [
  'rc-gates.yml',
  'pro-stt-artifact-matrix.yml',
  'live-release-matrix.yml',
  'v4-app-path-proof.yml',
  'v4-auto-fallback-proof.yml',
  'v4-benchmark-gpu.yml',
  'benchmarks.yml',
  'setup-test-users.yml',
];
const SHARED_GROUP = 'provenance-shared-pro-account';

describe('provenance is operationally wired into every data-producing workflow', () => {
  for (const wf of DATA_PRODUCING) {
    it(`${wf}: registers provenance via the reusable action before product writes`, () => {
      expect(read(wf)).toMatch(/uses:\s*\.\/\.github\/actions\/register-provenance/);
    });
    it(`${wf}: has an if: always() expire cleanup step`, () => {
      const src = read(wf);
      expect(src).toMatch(/mode:\s*expire/);
      expect(src).toMatch(/if:\s*always\(\)/);
    });
    it(`${wf}: joins the shared-account concurrency group with cancel-in-progress: false`, () => {
      const src = read(wf);
      expect(src).toMatch(new RegExp(`group:\\s*${SHARED_GROUP}`));
      expect(src).toMatch(/cancel-in-progress:\s*false/);
    });
  }
});
