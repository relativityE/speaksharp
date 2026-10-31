/** Bounded transport admission, not a model evaluator or live-run authorization. */
export const LIMITS = Object.freeze({ takes: 18, caseMs: 420_000, wholeRunMs: 7_680_000,
  apiRequestsPerTake: 180, mutationsPerTake: 120, apiRequests: 3240, mutations: 2160,
  localRequestsPerTake: 3000, localRequests: 54000, assetRequestsPerTake: 100, assetRequests: 1800 });
export const MODELS = ['v2:base.en', 'parakeet:tdt-v3:int8', 'granite:turboctc-q4f16'] as const;
/** Reporter copies stay retained but never become a second canonical measurement. */
export function canonicalCaseReceipts<T extends {candidate:string;trial:number;clip:string}>(entries:Array<{path:string;row:T}>):T[]{
  const seen=new Set<string>();const rows:T[]=[];
  for(const entry of entries){
    if(!/\/attachments\/independent-app-comparison\.json$/.test(entry.path))continue;
    const key=`${entry.row.candidate}:${entry.row.trial}:${entry.row.clip}`;
    if(seen.has(key))throw Error('bounded_duplicate_canonical_case_receipt');
    seen.add(key);rows.push(entry.row);
  }
  return rows;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type Rule = { maximum: number; mutation: boolean; subject?: string };
// Absolute maxima, including retries; a blocked request is never forwarded. No generic RPC permission.
const RPC: Record<string, Rule> = {
  acquire_recording_lease: { maximum: 1, mutation: true, subject: 'p_lease_id' },
  heartbeat_recording_lease: { maximum: 85, mutation: true, subject: 'p_lease_id' },
  release_recording_lease: { maximum: 2, mutation: true, subject: 'p_lease_id' },
  create_session_and_update_usage: { maximum: 1, mutation: true },
  complete_session_v2: { maximum: 2, mutation: true, subject: 'p_session_id' },
  heartbeat_session: { maximum: 14, mutation: true, subject: 'p_session_id' },
  record_progress_evaluation: { maximum: 4, mutation: true, subject: 'p_session_id' },
  record_progress_recommendation: { maximum: 2, mutation: true, subject: 'p_source_session_id' },
  get_progress_obligations: { maximum: 10, mutation: false },
  get_analytics_summary: { maximum: 2, mutation: false },
  get_practice_streak: { maximum: 2, mutation: false },
};
export interface ExecutionApproval {
  schemaVersion: 1; decision: 'APPROVED'; runId: string; sourceHead: string;
  sourceDeltaSha256: string; sourceUntrackedSha256: string; driverSha256: string;
  assetReceiptSha256: string;
  backendContractSha256: string;
  campaignSha256: string;
  appOrigin: string; apiOrigin: string; expectedUserId: string;
  accountReference: string; expiresAt: string; takes: number;
  retention: 'EMPTY_EXISTING_TEST_ACCOUNT_NORMAL_NEWEST_ONE';
  maxApiRequests: 3240; maxMutations: 2160; wholeRunMs: 7680000;
  /** Conservative upper bounds already consumed by known pre-recording attempts. Never measured metrics. */
  reservedBeforeRun?: { apiRequests: number; mutations: number; localRequests: number; assetRequests: number; loopbackWebSockets?:number };
  /** Only exact authenticated run-owned prior attempts; never arbitrary account history. */
  resume?: { priorSessionIds: string[]; priorCaseKeys: string[]; receiptSha256: string; retryCaseKeys?:string[] };
}
export function validateApproval(a: ExecutionApproval, now: number): void {
  if(a.resume && (!Array.isArray(a.resume.priorSessionIds)||!Array.isArray(a.resume.priorCaseKeys)
    ||a.resume.priorCaseKeys.length<1||a.resume.priorCaseKeys.length>=LIMITS.takes
    ||a.resume.priorSessionIds.length>a.resume.priorCaseKeys.length
    ||new Set(a.resume.priorSessionIds).size!==a.resume.priorSessionIds.length
    ||new Set(a.resume.priorCaseKeys).size!==a.resume.priorCaseKeys.length
    ||a.resume.priorSessionIds.some(id=>typeof id!=='string'||!UUID.test(id))||a.resume.priorCaseKeys.some(key=>typeof key!=='string'||!/^[A-Za-z0-9:._-]{1,160}$/.test(key))
    ||!/^[a-f0-9]{64}$/.test(a.resume.receiptSha256)
    ||(a.resume.retryCaseKeys&&(!Array.isArray(a.resume.retryCaseKeys)||new Set(a.resume.retryCaseKeys).size!==a.resume.retryCaseKeys.length
      ||a.resume.retryCaseKeys.some(key=>!a.resume!.priorCaseKeys.includes(key))))))throw Error('bounded_resume_binding_invalid');
  if(a.reservedBeforeRun && Object.entries({apiRequests:LIMITS.apiRequests,mutations:LIMITS.mutations,
    localRequests:LIMITS.localRequests,assetRequests:LIMITS.assetRequests,loopbackWebSockets:72}).some(([key,limit])=>{
      const value=a.reservedBeforeRun![key as keyof NonNullable<ExecutionApproval['reservedBeforeRun']>]??(key==='loopbackWebSockets'?0:NaN);
      return !Number.isInteger(value)||value<0||value>limit;
    })) throw Error('bounded_prior_reservation_invalid');
  if (a.schemaVersion !== 1 || a.decision !== 'APPROVED' || !/^[a-zA-Z0-9_-]{8,80}$/.test(a.runId)
    || !/^[a-f0-9]{40}$/.test(a.sourceHead) || !UUID.test(a.expectedUserId)
    || !/^[a-zA-Z0-9_-]{4,80}$/.test(a.accountReference)
    || ![a.sourceDeltaSha256, a.sourceUntrackedSha256, a.driverSha256, a.assetReceiptSha256, a.backendContractSha256, a.campaignSha256].every(x => /^[a-f0-9]{64}$/.test(x))
    || !Number.isInteger(a.takes) || a.takes < 1 || a.takes > LIMITS.takes || a.maxApiRequests !== LIMITS.apiRequests || a.maxMutations !== LIMITS.mutations
    || a.wholeRunMs !== LIMITS.wholeRunMs || a.retention !== 'EMPTY_EXISTING_TEST_ACCOUNT_NORMAL_NEWEST_ONE'
    || !Number.isFinite(Date.parse(a.expiresAt)) || Date.parse(a.expiresAt) <= now
    || Date.parse(a.expiresAt) - now > LIMITS.wholeRunMs) throw Error('bounded_approval_missing_or_invalid');
  const app = new URL(a.appOrigin); const api = new URL(a.apiOrigin);
  if (!['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5174', 'http://localhost:5174'].includes(a.appOrigin)
    || app.origin !== a.appOrigin || api.origin !== a.apiOrigin || api.protocol !== 'https:'
    || api.username || api.password) throw Error('bounded_origin_invalid');
}
/** A separately retained read-only source-contract review is required; approval alone cannot waive it. */
export function requireCompatibleBackend(receipt: {sourceHead?:string;apiOrigin?:string;status?:string;
  canonicalAuthorityExactSessionRead?:boolean;selectedModelDeclarationMatches?:boolean;models?:string[]}, approval: ExecutionApproval, models: readonly string[] = MODELS): void {
  if(receipt.status!=='COMPATIBLE' || receipt.sourceHead!==approval.sourceHead || receipt.apiOrigin!==approval.apiOrigin
    || receipt.canonicalAuthorityExactSessionRead!==true || receipt.selectedModelDeclarationMatches!==true
    || receipt.models?.length!==models.length || models.some(id=>!receipt.models?.includes(id))) {
    throw Error('bounded_backend_contract_unresolved');
  }
}
type Request = { url: string; method: string; body?: unknown; preflightMethod?: string };
/** Missing clocks/signals stay unmeasured; never clamp a negative delta into a fast result. */
export function elapsedMs(start: unknown, end: unknown): number | null {
  return typeof start === 'number' && typeof end === 'number' && Number.isFinite(start)
    && Number.isFinite(end) && start >= 0 && end >= start ? end - start : null;
}
export function privateTimingMetrics(snapshot: Record<string, unknown> | null, startMs: number | null,
  stopMs: number | null, observedMs: number, sameCapture: boolean) {
  const number = (key: string) => typeof snapshot?.[key] === 'number' && Number.isFinite(snapshot[key])
    && (snapshot[key] as number) >= 0 ? snapshot[key] as number : null;
  const updated = number('updatedAtMs');
  if (!sameCapture || startMs === null || stopMs === null || updated === null || updated < stopMs
    || updated < startMs || updated > observedMs + 0.1) return null;
  const decodeMs = number('finalizeDecodeMs'); const seconds = number('decodedUtteranceSeconds');
  return { finalizeDecodeMs: decodeMs, decodedUtteranceSeconds: seconds,
    rtf: decodeMs !== null && seconds !== null && seconds > 0 ? decodeMs / (1000 * seconds) : null,
    finalizeWaitMs: number('finalizeWaitMs'), finalizePrepMs: number('finalizePrepMs'),
    peakBufferedSeconds: number('peakBufferedSeconds'), firstProvisionalMs: number('timeToFirstProvisionalMs'),
    firstFinalMs: number('timeToFirstFinalMs'), anchor: ['speech','stream'].includes(String(snapshot?.anchor)) ? snapshot?.anchor : null };
}
export class ComparisonBudget {
  private deadline: number;
  private takeDeadline = 0;
  private take = 0;
  private counts: Record<string, number> = {};
  private takeRequests = 0;
  private takeMutations = 0;
  private requests = 0;
  private mutations = 0;
  private localRequests = 0;
  private takeLocalRequests = 0;
  private assetRequests = 0;
  private takeAssetRequests = 0;
  private sockets = 0;
  private takeSockets = 0;
  private session: string | null = null;
  private lease: string | null = null;
  private recording: string | null = null;
  private failures: string[] = [];
  private previousSessions = new Set<string>();
  private priorOwnedSessions = new Set<string>();
  private confirmedStarts=0;
  private reservedStarts=0;
  private currentStartReserved=false;
  private maximumCaseAdmissions:number=LIMITS.takes;
  constructor(private approval: ExecutionApproval, private now = Date.now) {
    validateApproval(approval, now());
    this.requests=approval.reservedBeforeRun?.apiRequests??0;
    this.mutations=approval.reservedBeforeRun?.mutations??0;
    this.localRequests=approval.reservedBeforeRun?.localRequests??0;
    this.assetRequests=approval.reservedBeforeRun?.assetRequests??0;
    this.sockets=approval.reservedBeforeRun?.loopbackWebSockets??0;
    this.priorOwnedSessions=new Set(approval.resume?.priorSessionIds??[]);
    this.take=approval.resume?.priorCaseKeys.length??0;
    this.confirmedStarts=this.reservedStarts=this.priorOwnedSessions.size;
    // A known no-session setup failure is an attempt, not an actual recording.
    this.maximumCaseAdmissions=approval.takes+this.take-this.priorOwnedSessions.size;
    this.deadline = Math.min(now() + LIMITS.wholeRunMs, Date.parse(approval.expiresAt));
  }
  private refuse(code: string): never { this.failures.push(code); throw Error(code); }
  rejectTransport(code: 'bounded_redirect_refused'|'bounded_transport_error'): never { return this.refuse(code); }
  assertHealthy(): void {
    if (this.failures.length) throw Error('bounded_run_previously_failed');
    if (this.now() >= this.deadline || (this.takeDeadline > 0 && this.now() >= this.takeDeadline)) this.refuse('bounded_deadline_exceeded');
  }
  beginTake(): void {
    this.assertHealthy();
    if (++this.take > this.maximumCaseAdmissions) this.refuse('bounded_take_count_exceeded');
    this.takeDeadline = this.now() + LIMITS.caseMs;
    this.counts = {}; this.takeRequests = this.takeMutations = 0;
    this.takeLocalRequests = this.takeAssetRequests = 0;
    this.takeSockets = 0;
    this.session = this.lease = this.recording = null;
    this.currentStartReserved=false;
  }
  bindSession(id: unknown): void {
    if (typeof id !== 'string' || !UUID.test(id) || (this.session && this.session !== id)
      || this.previousSessions.has(id)||this.priorOwnedSessions.has(id)) this.refuse('bounded_session_identity_changed');
    if(!this.session){
      if(!this.currentStartReserved){if(this.reservedStarts>=this.approval.takes)this.refuse('bounded_recording_start_count_exceeded');this.reservedStarts++;this.currentStartReserved=true;}
      this.confirmedStarts++;
    }
    this.session = id;
  }
  finishTake(): void {
    this.assertHealthy();
    if (!this.session) this.refuse('bounded_session_missing');
    this.previousSessions.add(this.session);
  }
  assertExistingSessions(ids: unknown[]): void {
    if (ids.some(id => typeof id !== 'string' || (!this.previousSessions.has(id)&&!this.priorOwnedSessions.has(id)))) this.refuse('bounded_account_not_empty_or_run_owned');
  }
  finishRun(): void {
    this.assertHealthy();
    if (this.confirmedStarts !== this.approval.takes || this.previousSessions.size+this.priorOwnedSessions.size !== this.approval.takes) this.refuse('bounded_population_incomplete');
  }
  snapshot() { return { takesStarted: this.confirmedStarts,actualRecordingStarts:this.confirmedStarts,reservedRecordingStarts:this.reservedStarts,
    caseAttempts:this.take,maximumCaseAdmissions:this.maximumCaseAdmissions,completedSessionCount: this.previousSessions.size,
    priorOwnedAttemptCount:this.approval.resume?.priorCaseKeys.length??0,priorOwnedSessionCount:this.priorOwnedSessions.size,reservedBeforeRun:this.approval.reservedBeforeRun??null,
    guardAccounted:{apiRequests:this.requests,mutations:this.mutations,localRequests:this.localRequests,assetRequests:this.assetRequests,loopbackWebSockets:this.sockets},
    apiRequests: this.requests-(this.approval.reservedBeforeRun?.apiRequests??0), mutationRequests: this.mutations-(this.approval.reservedBeforeRun?.mutations??0), takeApiRequests: this.takeRequests,
    localRequests: this.localRequests-(this.approval.reservedBeforeRun?.localRequests??0), cachedAssetRequests: this.assetRequests-(this.approval.reservedBeforeRun?.assetRequests??0),
    loopbackWebSockets: this.sockets-(this.approval.reservedBeforeRun?.loopbackWebSockets??0),
    takeMutationRequests: this.takeMutations, endpointCounts: { ...this.counts }, failures: [...this.failures] }; }
  admitWebSocket(raw: string): void {
    this.assertHealthy();
    const socket = new URL(raw); const app = new URL(this.approval.appOrigin);
    if (socket.protocol !== 'ws:' || socket.host !== app.host || socket.pathname !== '/') this.refuse('bounded_external_websocket');
    if (++this.sockets > 72 || ++this.takeSockets > 4) this.refuse('bounded_socket_count_exceeded');
  }
  admitCachedAsset(): void {
    this.assertHealthy();
    if (++this.assetRequests > LIMITS.assetRequests || ++this.takeAssetRequests > LIMITS.assetRequestsPerTake) this.refuse('bounded_asset_request_count_exceeded');
  }
  admit(request: Request): void {
    this.assertHealthy();
    if (!this.takeDeadline) this.refuse('bounded_take_not_started');
    const u = new URL(request.url);
    // Only loopback assets and the explicitly bound API. No CDN/model download, telemetry or provider escape.
    if (u.origin === this.approval.appOrigin && request.method === 'GET') {
      if (++this.localRequests > LIMITS.localRequests || ++this.takeLocalRequests > LIMITS.localRequestsPerTake) this.refuse('bounded_local_request_count_exceeded');
      return;
    }
    if (u.origin !== this.approval.apiOrigin || u.username || u.password) this.refuse('bounded_external_request');
    if (u.pathname === '/rest/v1/session_attribution_authority'
      && (!this.session || u.searchParams.get('session_id') !== 'eq.' + this.session
        || [...u.searchParams.keys()].some(key => !['select','session_id'].includes(key)))) this.refuse('bounded_authority_subject');
    if (++this.requests > LIMITS.apiRequests || ++this.takeRequests > LIMITS.apiRequestsPerTake) this.refuse('bounded_request_count_exceeded');
    const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {};
    let rule: Rule | undefined;
    let key = u.pathname;
    if (request.method === 'OPTIONS') {
      const read = request.preflightMethod === 'GET' && (u.pathname === '/auth/v1/user' || /^\/rest\/v1\/[a-z_]+$/.test(u.pathname));
      const write = request.preflightMethod === 'POST' && (['/auth/v1/token', '/functions/v1/check-usage-limit',
        '/functions/v1/attest-session-engine'].includes(u.pathname) || !!RPC[u.pathname.replace(/^\/rest\/v1\/rpc\//, '')]);
      if (!read && !write) this.refuse('bounded_preflight_not_allowed');
      key = 'preflight'; rule = { maximum: 40, mutation: false };
    } else if (request.method === 'GET' && (u.pathname === '/auth/v1/user' || /^\/rest\/v1\/[a-z_]+$/.test(u.pathname))) {
      rule = { maximum: 40, mutation: false }; key = 'read';
    } else if (request.method === 'POST' && u.pathname === '/auth/v1/token') {
      const grant = u.searchParams.get('grant_type');
      if (!['password', 'refresh_token'].includes(grant ?? '')) this.refuse('bounded_auth_operation');
      key += ':' + grant; rule = { maximum: grant === 'password' ? 1 : 2, mutation: false };
    } else if (request.method === 'POST' && u.pathname === '/functions/v1/check-usage-limit') {
      rule = { maximum: 8, mutation: false };
    } else if (request.method === 'POST' && u.pathname === '/functions/v1/attest-session-engine') {
      // Same origin AND exact operation AND this take's identity. No resolve-unattributed escape.
      const op = body.op;
      if (op === 'register') {
        if (typeof body.recordingKey !== 'string' || !UUID.test(body.recordingKey)
          || (this.recording && this.recording !== body.recordingKey)) this.refuse('bounded_recording_identity_changed');
        this.recording = body.recordingKey; key += ':register'; rule = { maximum: 1, mutation: true };
      } else if (op === 'bind') {
        if (!this.recording || body.recordingKey !== this.recording || !this.session || body.sessionId !== this.session) this.refuse('bounded_attestation_subject');
        key += ':bind'; rule = { maximum: 1, mutation: true };
      } else if (op === undefined && body.runtimeEvidence && this.session && body.sessionId === this.session) {
        key += ':terminal'; rule = { maximum: 2, mutation: true };
      } else this.refuse('bounded_attestation_operation');
    } else if (request.method === 'POST' && u.pathname.startsWith('/rest/v1/rpc/')) {
      const name = u.pathname.slice('/rest/v1/rpc/'.length); rule = RPC[name];
      if (!rule) this.refuse('bounded_rpc_not_allowed');
      if (name === 'acquire_recording_lease') {
        if (body.p_force !== false || typeof body.p_lease_id !== 'string' || !UUID.test(body.p_lease_id)) this.refuse('bounded_lease_force_or_identity');
        this.lease = body.p_lease_id;
      } else if (rule.subject === 'p_lease_id' && (!this.lease || body.p_lease_id !== this.lease)) this.refuse('bounded_lease_subject');
      else if (rule.subject === 'p_session_id' || rule.subject === 'p_source_session_id') {
        const id = body[rule.subject];
        const previousProgress = name.startsWith('record_progress_') && typeof id === 'string' && (this.previousSessions.has(id)||this.priorOwnedSessions.has(id));
        if ((!this.session || id !== this.session) && !previousProgress) this.refuse('bounded_session_subject');
      }
      if (name === 'create_session_and_update_usage') {
        const data = body.p_session_data as Record<string, unknown> | undefined;
        if (body.p_idempotency_key !== this.recording || !this.recording || !data
          || data.user_id !== this.approval.expectedUserId || data.lease_id !== this.lease
          || body.p_engine_type !== 'private') this.refuse('bounded_create_subject');
        // Reserve BEFORE forwarding; a lost/uncertain response never silently refunds a Start.
        if(!this.currentStartReserved){if(this.reservedStarts>=this.approval.takes)this.refuse('bounded_recording_start_count_exceeded');this.reservedStarts++;this.currentStartReserved=true;}
      }
    }
    if (!rule) this.refuse('bounded_endpoint_not_allowed');
    this.counts[key] = (this.counts[key] ?? 0) + 1;
    if (this.counts[key] > rule.maximum) this.refuse('bounded_endpoint_count_exceeded');
    if (rule.mutation && (++this.mutations > LIMITS.mutations || ++this.takeMutations > LIMITS.mutationsPerTake)) this.refuse('bounded_mutation_count_exceeded');
  }
}
