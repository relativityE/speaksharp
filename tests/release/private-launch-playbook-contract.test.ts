import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const processDoc = read('product_release/RELEASE_PROCESS.md');
const rehearsal = read('product_release/evidence/ISSUE_1267_PRIVATE_LAUNCH_REHEARSAL.md');
const workingInstructions = read('AGENTS.md');
const edgeReleaseWorkflow = read('.github/workflows/deploy-supabase-edge-release.yml');

describe('#1267 Private-only launch support contract', () => {
  it('scopes the Private-only gate to accepted, deployed, and reconciled product authority', () => {
    expect(processDoc).toMatch(/Conditional procedure — not the current release gate/i);
    expect(processDoc).toMatch(/#1254 \/ PR #1269[\s\S]*independently accepted, merged, and deployed/i);
    expect(processDoc).toMatch(/canonical product authorities and tester[\s>]+contract are reconciled/i);
    expect(processDoc).toMatch(/must not be used to GO or HOLD the current product/i);
    expect(processDoc).toMatch(/does not duplicate or[\s>]+authorize #1254 implementation/i);
  });

  it('makes Private the only path inside the conditional procedure and forbids retired recovery paths', () => {
    expect(processDoc).toMatch(/Private is the only customer transcription path/i);
    expect(processDoc).toMatch(/Browser, Native, Cloud, Guided, and a\s+Private sample are not recovery paths/i);
    expect(processDoc).toMatch(/never offer Browser\/Cloud/i);
    expect(processDoc).not.toMatch(/present Cloud\/Native as explicit user-selectable alternatives/i);
  });

  it('fails closed on release identity and exact-head evidence', () => {
    expect(processDoc).toMatch(/window\.__APP_RELEASE__/);
    expect(processDoc).toMatch(/Unknown or unequal identities mean HOLD/i);
    expect(processDoc).toMatch(/red, skipped, absent, stale, or still running/i);
  });

  it('keeps triage content-free and does not overclaim pseudonymous identity', () => {
    expect(processDoc).toMatch(/Do not include `title`, `description`, `transcript_excerpt`/i);
    expect(processDoc).toMatch(/Do not claim a report or telemetry identity is pseudonymous unless/i);
    expect(processDoc).toMatch(/Never select transcript text for ordinary support triage/i);
  });

  it('covers every required product and recovery decision boundary', () => {
    for (const required of [
      'Authentication',
      'Private setup',
      'Record',
      'Finalize',
      'Save',
      'History / Progress / PDF',
      'Retention',
      'Mobile',
      'Frontend',
      'Edge',
      'Migration/database',
      'Config/secret/flag',
    ]) {
      expect(processDoc).toContain(required);
    }
  });

  it('gates every production mutation and defines GO/HOLD ownership', () => {
    expect(processDoc).toMatch(/Every production mutation is separately authorized/i);
    expect(processDoc).toMatch(/primary, backup, acknowledgement channel, and handoff time/i);
    expect(processDoc).toMatch(/Unchecked means HOLD/i);
    expect(processDoc).not.toMatch(/deploy one Edge Function without a full CI run/i);
  });

  it('treats billing incidents according to the separately authorized commercial phase', () => {
    expect(processDoc).toMatch(/Billing response is phase-aware/i);
    expect(processDoc).toMatch(/Before separately authorized commercial activation[\s\S]*fail-closed/i);
    expect(processDoc).toMatch(/After\s+activation, the validated \$10\/month checkout and paid continuation are expected/i);
    expect(processDoc).not.toMatch(/paid path reachable \| 5 minutes/i);
    expect(processDoc).not.toMatch(/free-beta truth/i);
  });

  it('states the current path-filtered Edge deployment boundary', () => {
    expect(processDoc).toMatch(/deploy-supabase-edge-release\.yml/);
    expect(processDoc).toMatch(/frontend- or docs-only merge does not trigger this caller/i);
    expect(processDoc).toMatch(/deploys every function in its reviewed list/i);
    expect(workingInstructions).toMatch(/changes `backend\/supabase\/functions\/\*\*`/i);
    expect(workingInstructions).toMatch(/push without an Edge trigger path\s+does not start that caller/i);
    expect(edgeReleaseWorkflow).toMatch(/push:\s*\n\s*branches: \[main\]\s*\n\s*paths:/);
    expect(edgeReleaseWorkflow).toContain("- 'backend/supabase/functions/**'");
  });

  it('records a non-destructive drill without claiming production execution or GO', () => {
    expect(rehearsal).toMatch(/Production mutation:\*\* none/i);
    expect(rehearsal).toMatch(/not current release status and not GO/i);
    expect(rehearsal).toMatch(/Exercise result:\*\* PASS at the source-procedure boundary/i);
    expect(rehearsal).toMatch(/No rollback\/deploy command is executed/i);
    expect(rehearsal).toMatch(/does not satisfy the conditional #1254\/product-authority prerequisites/i);
  });

  it('preserves truthful human-review metadata while recording source verification separately', () => {
    // #1416 — the DATES are not the contract.
    //
    // This pinned `Last Reviewed: 2026-07-30` and `Last Verified: 2026-08-11`, so every legitimate
    // review of the document broke it — which is exactly what the currentization did. A test that
    // fails when a doc is reviewed on schedule is testing the calendar, and it trains people to edit
    // the assertion rather than read it.
    //
    // What this contract is actually for is that the two facts stay SEPARATE and both stay dated:
    // human review and source verification are different claims, and collapsing them lets a document
    // that nobody has read inherit the credibility of one that was merely re-verified.
    const reviewed = processDoc.match(/\*\*Last Reviewed:\*\* (\d{4}-\d{2}-\d{2})/);
    const verified = processDoc.match(/\*\*Last Verified:\*\* (\d{4}-\d{2}-\d{2})/);
    expect(reviewed?.[1], 'RELEASE_PROCESS.md must record a dated human review').toBeTruthy();
    expect(verified?.[1], 'RELEASE_PROCESS.md must record a dated source verification').toBeTruthy();
    // Both fields present as distinct lines — not one standing in for the other.
    expect(processDoc).toMatch(/\*\*Last Reviewed:\*\*[^\n]*\n[\s\S]*\*\*Last Verified:\*\*/);
    expect(rehearsal).toMatch(/exact-head re-review required/i);
  });
});
