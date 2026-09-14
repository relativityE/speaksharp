/**
 * RWT-01 — the PRE-TAKE CONTROL for a qualifying comparison take (PM 5663484274, PO/PM 5663876247).
 *
 * The retired observer stayed attached for the whole take: it held every new worker paused at startup, injected a
 * network tripwire into it, navigated the tab and replaced fetch/XHR/beacon/WebSocket. On Production `1b311f9` every observer-attached Start stalled for minutes. An instrument that changes the
 * product cannot measure it.
 *
 * This phase does only what the hidden candidate switch requires, then leaves:
 *   1. install the one-use comparison authorization before boot (the switch only exists if it is present at boot);
 *   2. boot one fresh document and remove the installer;
 *   3. switch the candidate and require requested = observed = expected, on the authorized release;
 *   4. DISCONNECT — before the operator is told to start.
 *
 * Nothing observes the take. Journey evidence comes from the app's governed telemetry; audio-egress proof comes from a
 * separate, nonqualifying privacy run. Every command goes through an allowlist, so an invasive method cannot be sent
 * from here by mistake.
 */
import { modelComparisonArmExpression, modelComparisonSwitchExpression } from './modelComparisonArm.mjs';

export const PRE_TAKE_CONTROL_KIND = 'pre_take_control';

/** The only CDP methods the control phase may send. */
export const ALLOWED_CONTROL_METHODS = Object.freeze([
  'Page.enable', 'Page.addScriptToEvaluateOnNewDocument', 'Page.navigate', 'Page.removeScriptToEvaluateOnNewDocument',
  'Runtime.evaluate',
]);

export const SURFACE_READY_EXPRESSION = `typeof globalThis.__SS_SWITCH_CANDIDATE__ === 'function'
  && typeof globalThis.__SS_ACTIVE_CANDIDATE__ === 'function'`;
export const RELEASE_EXPRESSION = 'globalThis.__APP_RELEASE__ ?? null';

/** Wrap a CDP page session so only allowlisted methods can be sent, and record which were. */
export function guardControlClient(client) {
  const methodsUsed = [];
  return {
    methodsUsed,
    send: async (method, params = {}) => {
      if (!ALLOWED_CONTROL_METHODS.includes(method)) {
        throw new Error(`CDP method ${method} is not permitted in the pre-take control`);
      }
      if (!methodsUsed.includes(method)) methodsUsed.push(method);
      return client.send(method, params);
    },
  };
}

export async function runPreTakeControl({
  openClient, appUrl, authorization, candidate, journey, expectedRelease, probeAttachment,
  surfaceTimeoutMs = 30_000, sleep = (ms) => new Promise((r) => { setTimeout(r, ms); }),
}) {
  // Opened only after a clean exclusivity probe: an open page client is itself an attachment (PM RETURN 5664428448).
  let client = null;
  const guarded = guardControlClient({ send: (method, params) => client.send(method, params) });
  const problems = [];
  const control = {
    methodsUsed: guarded.methodsUsed, armScriptsInstalled: 0, armScriptRemoved: false,
    tripwireInstalled: false, workerAttachment: false, networkObservation: false,
    disconnectedBeforeTake: false, disconnectedAt: null, exclusiveBeforeArm: false, noAttachmentAfterDisconnect: false,
  };
  // Browser-level attachment of the app page, read without instrumenting it (Codex 4005311870). Unreadable is not free.
  const attached = async () => {
    try { return (await probeAttachment()).attached !== false; } catch { return null; }
  };
  let installerId = null;
  let identity = null;
  let release = null;
  try {
    const before = await attached();
    if (before !== false) {
      throw new Error(before === null ? 'the page attachment state could not be read'
        : 'the app page is already attached to another debugger; close it before preparing the take');
    }
    control.exclusiveBeforeArm = true;
    client = await openClient();
    // The page never sees when Node verified the run.
    const pageAuthorization = Object.fromEntries(Object.entries(authorization).filter(([key]) => key !== 'verifiedAt'));
    await guarded.send('Page.enable');
    const installer = await guarded.send('Page.addScriptToEvaluateOnNewDocument', {
      source: modelComparisonArmExpression(pageAuthorization),
    });
    installerId = installer.identifier;
    control.armScriptsInstalled = 1;
    await guarded.send('Page.navigate', { url: appUrl });
    // ONE DOCUMENT ONLY: removed before anything else can load a second document with the same authorization.
    await guarded.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: installerId });
    control.armScriptRemoved = true;

    const deadline = Date.now() + surfaceTimeoutMs;
    let ready = false;
    for (;;) {
      const availability = await guarded.send('Runtime.evaluate', { expression: SURFACE_READY_EXPRESSION, returnByValue: true });
      if (availability?.result?.value === true) { ready = true; break; }
      if (Date.now() >= deadline) break;
      await sleep(250);
    }
    if (!ready) {
      problems.push('the comparison switch surface did not install on the authorized document');
    } else {
      const switched = await guarded.send('Runtime.evaluate', {
        expression: modelComparisonSwitchExpression(candidate, journey), returnByValue: true, awaitPromise: true,
      });
      const value = switched?.exceptionDetails ? null : switched?.result?.value;
      if (value?.outcome?.ok !== true) {
        problems.push(`the candidate switch was refused: ${value?.outcome?.code ?? 'no outcome'}`);
      }
      identity = value?.active ?? null;
      if (!identity || identity.requested !== candidate || identity.observed !== candidate
        || identity.expected !== candidate || identity.matches !== true) {
        problems.push('candidate identity did not match before the take (requested, observed and expected must agree)');
      }
      const served = await guarded.send('Runtime.evaluate', { expression: RELEASE_EXPRESSION, returnByValue: true });
      release = served?.result?.value ?? null;
      if (release !== expectedRelease) problems.push('the page does not serve the authorized release');
    }
  } catch (error) {
    problems.push(`pre-take control failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  } finally {
    // The installer is removed on EVERY path that installed it, before leaving (Codex 4005312289).
    if (installerId !== null && !control.armScriptRemoved) {
      try {
        await guarded.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: installerId });
        control.armScriptRemoved = true;
      } catch { problems.push('the authorization installer could not be removed'); }
    }
    // ALWAYS LEAVE. A HOLD that stays attached would still be an instrument on the page the operator uses next.
    if (client) await client.close();
    control.disconnectedBeforeTake = true;
    control.disconnectedAt = new Date().toISOString();
    // PASS only when NO debugger remains — not merely this one (Codex 4005311870).
    const after = await attached();
    control.noAttachmentAfterDisconnect = after === false;
    if (after !== false) problems.push(after === null ? 'the page attachment state could not be read after disconnect'
      : 'a debugger is still attached to the app page after this control disconnected');
  }

  return {
    evidenceKind: PRE_TAKE_CONTROL_KIND,
    verdict: problems.length === 0 ? 'PASS' : 'HOLD',
    holdKind: problems.length === 0 ? null : 'control',
    problems,
    dryRun: false,
    target: { origin: new URL(appUrl).origin },
    release,
    expectedCandidate: candidate,
    requestedCandidate: identity?.requested ?? null,
    observedCandidate: identity?.observed ?? null,
    journey,
    comparisonNonce: authorization.nonce,
    evidenceDocumentId: authorization.evidenceDocumentId,
    positiveControlNonce: authorization.evidenceDocumentId,
    authorization,
    capturedAt: new Date().toISOString(),
    control,
  };
}

/** Why a receipt cannot qualify a comparison row; empty when it is a disconnected pre-take control receipt. */
export function controlReceiptProblems(receipt) {
  const problems = [];
  if (receipt?.evidenceKind !== PRE_TAKE_CONTROL_KIND) {
    problems.push(`receipt evidenceKind must be "${PRE_TAKE_CONTROL_KIND}"; observer and privacy-diagnostic receipts cannot qualify a take`);
    return problems;
  }
  const c = receipt.control;
  if (!c || typeof c !== 'object') return [...problems, 'receipt has no control record'];
  // A malformed log proves nothing about what was sent (Codex 4005312297).
  if (!Array.isArray(c.methodsUsed) || c.methodsUsed.length === 0) {
    problems.push('the control method log must be a non-empty array of CDP method names');
  } else {
    for (const [index, method] of c.methodsUsed.entries()) {
      if (typeof method !== 'string' || !ALLOWED_CONTROL_METHODS.includes(method)) {
        problems.push(`control used a non-permitted CDP method: ${String(method)}`);
      } else if (c.methodsUsed.indexOf(method) !== index) problems.push(`the control method log repeats ${method}`);
    }
  }
  if (c.exclusiveBeforeArm !== true) problems.push('the page was not proven free of another debugger before arming');
  if (c.noAttachmentAfterDisconnect !== true) problems.push('a debugger attachment remained after the control disconnected');
  if (c.disconnectedBeforeTake !== true) problems.push('the control session did not disconnect before the take');
  if (c.tripwireInstalled !== false) problems.push('a network tripwire was installed on the qualifying page');
  if (c.workerAttachment !== false) problems.push('a worker attachment was reported on the qualifying page');
  if (c.networkObservation !== false) problems.push('network observation was enabled on the qualifying page');
  if (c.armScriptsInstalled !== 1) problems.push('the control must inject exactly one authorization script');
  if (c.armScriptRemoved !== true) problems.push('the authorization installer was left armed after boot');
  return problems;
}
