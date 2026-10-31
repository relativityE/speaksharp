import type { Page, Response } from 'playwright';
import { randomUUID } from 'node:crypto';
import { assertServedRelease, sha256, type SourceBinding } from './source-binding';
import { LIVE_INTERIM, LIVE_TRANSCRIPT, SESSION_SHELL, SESSION_STATE_ATTR, MIC_CONTROL_BY_STATUS, RECORDER_STOP } from '../../tests/helpers/micControls';
import { CANDIDATES, type Candidate } from '../../frontend/src/services/transcription/candidateRegistry';
import { productModelMetadata, verifyModelPackage } from '../../frontend/src/services/transcription/modelPackage';

export interface ProductEvidenceBinding {
  source: SourceBinding;
  candidateId: string;
  /** Resolved from the sealed campaign catalogue, never a caller-supplied expected identity. */
  candidate?: Candidate;
  backend: 'wasm' | 'webgpu';
  journey: 'open_mic' | 'focus_points';
  fixtureWavSha256: string;
  /** Approved Track A fixture windows, relative to observed playback start; no inferred acoustic labels. */
  focus?: Array<{ index: number; expected: 'covered' | 'partial' | 'missing'; audioWindowMs: [number, number] }>;
}

export interface ProductTimeline {
  timeOriginMs?: number;
  startClickMs?: number | null;
  stopClickMs?: number | null;
  release: string | null;
  startMs: number | null;
  stopMs: number | null;
  playbackStartMs: number | null;
  partials: Array<{ atMs: number; sha256: string; chars: number }>;
  sessions: string[];
  captures: string[];
  candidates: string[];
  backends: string[];
  focusChanges: Array<{ index: number; status: string; atMs: number }>;
  finalFocus: string[];
  failures: string[];
}

type TextReceipt = { sessionSha256: string; transcriptSha256: string; product?: string;
  attributionStatus?: string; engine?: string; engineVersion?: string; modelName?: string; deviceType?: string };
export type AuthorityReceipt = { sessionSha256: string; authorityVersion?: string; engineClass?: string;
  engine?: string; engineVersion?: string; modelName?: string; provider?: string; deviceType?: string };
export interface ProductEvidence {
  timeline: ProductTimeline | null;
  completion: TextReceipt[];
  persisted: TextReceipt[];
  reopened: TextReceipt | null;
  failures: string[];
  authority?: AuthorityReceipt[];
}

/** Evaluate observations, never a caller-supplied PASS. Missing evidence holds; contradictions fail. */
export function evaluateProductEvidence(binding: ProductEvidenceBinding, evidence: ProductEvidence) {
  const failures = [...evidence.failures, ...(evidence.timeline?.failures ?? [])];
  const holds: string[] = [];
  const timeline = evidence.timeline;
  if (!timeline) holds.push('product_timeline_unavailable');
  else {
    if (timeline.release !== binding.source.head) failures.push('product_release_mismatch');
    if (timeline.startMs === null || timeline.stopMs === null || timeline.stopMs <= timeline.startMs) holds.push('start_stop_unproven');
    if (!timeline.partials.some(row => row.chars > 0 && /^[a-f0-9]{64}$/.test(row.sha256)
      && timeline.startMs !== null && timeline.stopMs !== null && row.atMs >= timeline.startMs && row.atMs < timeline.stopMs)) {
      holds.push('partial_before_stop_unproven');
    }
    if (!timeline.sessions.length || !timeline.captures.length) holds.push('take_capture_binding_unavailable');
    if (new Set(timeline.sessions).size > 1 || new Set(timeline.captures).size > 1) failures.push('take_or_capture_changed');
    if (!timeline.candidates.length || !timeline.backends.length) holds.push('product_runtime_identity_unavailable');
    if (timeline.candidates.some(id => id !== binding.candidateId) || timeline.backends.some(id => id !== binding.backend)) failures.push('product_model_or_backend_mismatch');
    if (binding.journey === 'focus_points') {
      if (!binding.focus?.length || timeline.playbackStartMs === null) holds.push('focus_fixture_windows_unavailable');
      for (const point of binding.focus ?? []) {
        if (timeline.finalFocus[point.index] === undefined) holds.push(`focus_final_unavailable:${point.index}`);
        else if (timeline.finalFocus[point.index] !== point.expected) failures.push(`focus_final_mismatch:${point.index}`);
        if (point.expected !== 'missing') {
          const live = timeline.focusChanges.find(row => row.index === point.index && ['covered', 'partial'].includes(row.status));
          const start = timeline.playbackStartMs;
          if (!live || start === null || timeline.stopMs === null) holds.push(`focus_live_unproven:${point.index}`);
          else if (live.atMs >= timeline.stopMs || live.atMs < start + point.audioWindowMs[0] - 1000
            || live.atMs > start + point.audioWindowMs[1] + 5000) failures.push(`focus_live_outside_window:${point.index}`);
        }
      }
    }
  }
  if (!evidence.completion.length) holds.push('successful_completion_unavailable');
  if (!evidence.persisted.length) holds.push('persisted_transcript_unavailable');
  if (!evidence.reopened) holds.push('reopened_transcript_unavailable');
  const rows = [...evidence.completion, ...evidence.persisted, ...(evidence.reopened ? [evidence.reopened] : [])];
  if (rows.some(row => !/^[a-f0-9]{64}$/.test(row.sessionSha256) || !/^[a-f0-9]{64}$/.test(row.transcriptSha256))) failures.push('invalid_content_receipt');
  if (rows.length && rows.some(row => row.sessionSha256 !== rows[0].sessionSha256 || row.transcriptSha256 !== rows[0].transcriptSha256)) failures.push('saved_content_or_session_mismatch');
  if (timeline?.sessions.length && rows.some(row => !timeline.sessions.includes(row.sessionSha256))) failures.push('completion_not_recorded_take');
  if (evidence.persisted.some(row => row.product !== binding.journey)) failures.push('persisted_product_mismatch');
  // These are persisted declared identity fields, not observed weight identity.
  const candidate = binding.candidate ?? (Object.hasOwn(CANDIDATES,binding.candidateId) ? CANDIDATES[binding.candidateId] : null);
  const metadata = candidate ? productModelMetadata(candidate) : null;
  const modelName = metadata?.modelName;
  const engineVersion = metadata?.engineVersion;
  if (candidate && (candidate.id !== binding.candidateId || candidate.model.device !== binding.backend)) failures.push('product_binding_identity_mismatch');
  if (!candidate || !engineVersion) failures.push('persisted_candidate_identity_unsupported');
  // The canonical, owner-readable authority records the terminal verdict. Legacy
  // sessions.attribution_status is not its projection and commonly remains pending.
  // Neither a client-declared `verified` string nor browser diagnostics replace it.
  if (!evidence.authority?.length) holds.push('persisted_authority_unavailable');
  for (const row of evidence.authority ?? []) {
    if (!timeline?.sessions.includes(row.sessionSha256) || rows.some(saved => saved.sessionSha256 !== row.sessionSha256)) failures.push('authority_session_mismatch');
    if (row.authorityVersion !== 'attrib_v1' || row.engineClass !== 'private' || row.provider !== 'transformers-js') failures.push('persisted_authority_invalid');
    if (!row.engine || !row.engineVersion || !row.modelName || !row.deviceType) holds.push('persisted_attribution_unavailable');
    else if (row.engine !== 'private' || row.engineVersion !== engineVersion || row.modelName !== modelName || row.deviceType !== 'browser') failures.push('persisted_candidate_identity_mismatch');
  }
  for (const row of evidence.persisted) {
    if (!row.engine || !row.engineVersion || !row.modelName || !row.deviceType) holds.push('persisted_attribution_unavailable');
    else if (row.engine !== 'private' || row.engineVersion !== engineVersion || row.modelName !== modelName || row.deviceType !== 'browser') failures.push('persisted_candidate_identity_mismatch');
  }
  return { verdict: failures.length ? 'FAIL' as const : holds.length ? 'HOLD' as const : 'PASS' as const,
    reasons: [...new Set([...failures, ...holds])], scope: 'Observed STT product take only; no coaching/provider or model-promotion qualification' };
}

/** Self-contained browser callback: passive DOM/read-only diagnostics only, no clicks or product writes. */
export function installProductObserver(options: { key: string; interim: string; live: string; shell: string; stateAttribute: string; startControl: string; stopControl: string }) {
  const store = window as unknown as Record<string, unknown>;
  const metadata = (store.__APP_TEST_ENV__ ??= {}) as Record<string, unknown>;
  if (metadata[options.key]) throw new Error('product_observer_already_installed');
  const timeline: ProductTimeline = { release: (store.__APP_RELEASE__ as string | undefined) ?? null,
    timeOriginMs: performance.timeOrigin, startClickMs: null, stopClickMs: null,
    startMs: null, stopMs: null, playbackStartMs: null, partials: [], sessions: [], captures: [],
    candidates: [], backends: [], focusChanges: [], finalFocus: [], failures: [] };
  const pending: Promise<void>[] = [];
  let lastPartial = '';
  let sealed = false;
  // Capture before product handlers. Never synthesize, prevent or replace a click.
  const click = (event: MouseEvent) => {
    if (!event.isTrusted || sealed) return;
    const control = event.target instanceof Element ? event.target.closest('[data-testid]')?.getAttribute('data-testid') : null;
    if (control === options.startControl && timeline.startClickMs == null) timeline.startClickMs = performance.now();
    if (control === options.stopControl && timeline.startMs !== null && timeline.stopClickMs == null) timeline.stopClickMs = performance.now();
  };
  document.addEventListener('click', click, true);
  const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const appendHash = (values: string[], value: unknown) => {
    if (typeof value === 'string' && value) pending.push(digest(value).then(hash => { if (!values.includes(hash)) values.push(hash); }));
  };
  const sample = () => {
    if (sealed) return;
    const now = performance.now();
    const runtimeState = document.documentElement.getAttribute('data-runtime-state');
    const state = document.querySelector(`[data-testid="${options.shell}"]`)?.getAttribute(options.stateAttribute);
    const during = runtimeState === 'RECORDING' && state === 'during';
    if (during) {
      timeline.startMs ??= now;
      const debug = (store.__SPEECH_RUNTIME_DEBUG__ as (() => { sessionId?: string }) | undefined)?.();
      const capture = (store.__PRIVATE_CAPTURE_RECEIPT__ as (() => { captureId?: string; candidateId?: string; active?: boolean }) | undefined)?.();
      if (capture?.active) { appendHash(timeline.sessions, debug?.sessionId); appendHash(timeline.captures, capture.captureId); }
      if (capture?.candidateId && !timeline.candidates.includes(capture.candidateId)) timeline.candidates.push(capture.candidateId);
      const identity = store.__PRIVATE_STT_RUNTIME_DEBUG__ as { runtime?: string } | undefined;
      const backend = identity?.runtime?.startsWith('wasm') ? 'wasm' : identity?.runtime === 'webgpu' ? 'webgpu' : null;
      if (backend && !timeline.backends.includes(backend)) timeline.backends.push(backend);
      const text = document.querySelector(`[data-testid="${options.interim}"]`)?.textContent
        || document.querySelector(`[data-testid="${options.live}"]`)?.textContent || '';
      if (text.trim() && text !== lastPartial) {
        lastPartial = text;
        pending.push(digest(text).then(hash => { timeline.partials.push({ atMs: now, sha256: hash, chars: text.length }); }));
      }
    }
    if (timeline.startMs !== null && (runtimeState === 'STOPPING' || state === 'after')) timeline.stopMs ??= now;
    const playback = (store.__ss_fixturePlaybackState__ as (() => { startedAtMs?: number | null }) | undefined)?.();
    timeline.playbackStartMs ??= playback?.startedAtMs ?? null;
    const statuses = Array.from(document.querySelectorAll('[data-testid^="focus-point-"][data-status]')).map(element => ({
      index: Number(/^focus-point-(\d+)$/.exec(element.getAttribute('data-testid') ?? '')?.[1]), status: element.getAttribute('data-status') ?? '',
    })).filter(row => Number.isSafeInteger(row.index));
    for (const row of statuses) {
      if (!timeline.focusChanges.some(old => old.index === row.index && old.status === row.status)) timeline.focusChanges.push({ ...row, atMs: now });
      if (state === 'after') timeline.finalFocus[row.index] = row.status;
    }
  };
  const observer = new MutationObserver(sample);
  observer.observe(document.documentElement, { subtree: true, attributes: true, childList: true, characterData: true });
  sample();
  metadata[options.key] = { async freeze() {
    sample(); sealed = true; observer.disconnect(); document.removeEventListener('click', click, true);
    try { await Promise.all(pending); } catch { timeline.failures.push('product_observer_hash_failed'); }
    delete metadata[options.key];
    return timeline;
  } };
}

/** Attach to ONE already-authorized Track A take. This collector never drives or provisions a journey. */
export async function attachProductEvidence(page: Page, binding: ProductEvidenceBinding, approvedApiOrigin: string) {
  if (binding.candidate?.modelPackage) await verifyModelPackage(binding.candidate.modelPackage.descriptor);
  const origin = new URL(approvedApiOrigin);
  if (origin.origin !== approvedApiOrigin || origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('invalid_product_api_origin');
  if (!/^[a-f0-9]{64}$/.test(binding.fixtureWavSha256)) throw new Error('product_fixture_hash_required');
  assertServedRelease(binding.source, await page.evaluate(() => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__ ?? null));
  const key = `__model_evaluator_product_${randomUUID()}`;
  const evidence: ProductEvidence = { timeline: null, completion: [], persisted: [], authority: [], reopened: null, failures: [] };
  const responses: Promise<void>[] = [];
  const observe = async (response: Response) => {
    const url = new URL(response.url());
    if (url.origin !== approvedApiOrigin || !response.ok()) return;
    const request = response.request();
    if (url.pathname === '/rest/v1/rpc/complete_session_v2' && request.method() === 'POST') {
      const body = request.postDataJSON() as { p_status?: string; p_session_id?: string; p_final_transcript?: string };
      if (body.p_status === 'completed' && body.p_session_id && body.p_final_transcript) evidence.completion.push({
        sessionSha256: sha256(body.p_session_id), transcriptSha256: sha256(body.p_final_transcript),
      });
    } else if (url.pathname === '/rest/v1/session_attribution_authority' && request.method() === 'GET') {
      const selected = /^eq\.([a-f0-9-]{36})$/i.exec(url.searchParams.get('session_id') ?? '')?.[1];
      if (!selected || !evidence.timeline?.sessions.includes(sha256(selected))) return;
      const body: unknown = await response.json();
      if (!Array.isArray(body)) { evidence.failures.push('authority_response_invalid'); return; }
      if (body.length > 1) evidence.failures.push('authority_response_ambiguous');
      for (const row of body) {
        if (!row || typeof row !== 'object' || typeof row.session_id !== 'string') { evidence.failures.push('authority_response_invalid'); continue; }
        const field = (name: string) => typeof row[name] === 'string' ? row[name] as string : undefined;
        evidence.authority!.push({ sessionSha256: sha256(row.session_id), authorityVersion: field('authority_version'),
          engineClass: field('engine_class'), engine: field('engine'), engineVersion: field('engine_version'),
          modelName: field('model_id'), provider: field('provider'), deviceType: field('resolved_device') });
      }
    } else if (url.pathname === '/rest/v1/sessions' && request.method() === 'GET') {
      const selected = /^eq\.([a-f0-9-]{36})$/i.exec(url.searchParams.get('id') ?? '')?.[1];
      // Do not parse unrelated account history. Only this frozen take's exact-id read can prove persistence.
      if (!selected || !evidence.timeline?.sessions.includes(sha256(selected))) return;
      const body: unknown = await response.json();
      const rows: unknown[] = Array.isArray(body) ? body : [body];
      for (const row of rows) {
        if (row && typeof row === 'object' && 'id' in row && 'transcript' in row && 'product' in row
          && typeof row.id === 'string' && typeof row.transcript === 'string' && row.transcript.length && typeof row.product === 'string') {
          const field = (key: string) => key in row && typeof (row as Record<string, unknown>)[key] === 'string'
            ? (row as Record<string, string>)[key] : undefined;
          evidence.persisted.push({ sessionSha256: sha256(row.id), transcriptSha256: sha256(row.transcript), product: row.product,
            attributionStatus: field('attribution_status'), engine: field('engine'),
            engineVersion: field('engine_version'), modelName: field('model_name'), deviceType: field('device_type') });
        }
      }
    }
  };
  const listener = (response: Response) => { responses.push(observe(response).catch(() => { evidence.failures.push('product_response_observation_failed'); })); };
  page.on('response', listener);
  try {
    await page.evaluate(installProductObserver, { key, interim: LIVE_INTERIM, live: LIVE_TRANSCRIPT, shell: SESSION_SHELL, stateAttribute: SESSION_STATE_ATTR,
      startControl: MIC_CONTROL_BY_STATUS.ready, stopControl: RECORDER_STOP });
  } catch (error) { page.off('response', listener); throw error; }
  let frozen = false;
  return {
    /** Call after Stop/final save, BEFORE navigating away. Later response observations remain active for reopen. */
    async freezeTake() {
      if (frozen) throw new Error('product_take_already_frozen');
      frozen = true;
      evidence.timeline = await page.evaluate(async observerKey => {
        const observer = (window as unknown as { __APP_TEST_ENV__?: Record<string, { freeze(): Promise<ProductTimeline> }> }).__APP_TEST_ENV__?.[observerKey];
        if (!observer) throw new Error('product_observer_missing');
        return observer.freeze();
      }, key);
      return evidence.timeline;
    },
    /** Call after the EXISTING journey reopens its saved session. No navigation is initiated here. */
    async observeReopened() {
      const reopened = await page.evaluate(() => ({
        release: (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__,
        sessionId: /^\/progress\/([a-f0-9-]{36})$/i.exec(location.pathname)?.[1] ?? null,
        text: (document.querySelector('[data-testid="session-detail-transcript"]') as HTMLElement | null)?.innerText ?? null,
      }));
      assertServedRelease(binding.source, reopened.release);
      if (reopened.sessionId && reopened.text) evidence.reopened = { sessionSha256: sha256(reopened.sessionId), transcriptSha256: sha256(reopened.text) };
    },
    async finish() {
      page.off('response', listener);
      await Promise.all(responses);
      if (!frozen) {
        evidence.failures.push('product_take_not_frozen_before_navigation');
        try {
          await page.evaluate(async observerKey => {
            const observer = (window as unknown as { __APP_TEST_ENV__?: Record<string, { freeze(): Promise<ProductTimeline> }> }).__APP_TEST_ENV__?.[observerKey];
            await observer?.freeze();
          }, key);
        } catch { evidence.failures.push('product_observer_cleanup_unconfirmed'); }
      }
      // Ignore unrelated history rows; equality is evaluated only for this observed recording's session.
      evidence.persisted = evidence.persisted.filter(row => evidence.timeline?.sessions.includes(row.sessionSha256));
      return { binding, evidence, productProof: evaluateProductEvidence(binding, evidence),
        limitations: ['No provider/coaching qualification', 'Fixture WAV hash is configured provenance, not a microphone PCM hash',
          'No database-wide exactly-once claim', 'This collector itself does not authorize or prove a live execution'] };
    },
  };
}
