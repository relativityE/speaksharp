/**
 * THE PROMISE IS ABOUT AUDIO, NOT ABOUT TRAFFIC.
 *
 * The previous audit reported every unrecognised request as suspect, so ordinary Sentry and PostHog
 * traffic produced HOLD on a page that had not recorded anything — no audio could possibly have left.
 * That tool proved "no unrecognised network traffic", which SpeakSharp does not promise and does not
 * want to: the product deliberately persists final transcript TEXT server-side for the two newest
 * transcript-bearing sessions, and says so.
 *
 * A check that permanently holds valid takes gets solved by allowlisting vendors, and a vendor
 * allowlist authorises whatever that vendor is sent — including audio. So the discriminator has to be
 * the PAYLOAD, not the destination.
 *
 * This tripwire is installed BEFORE app code and wraps every send path. It records what KIND of thing
 * was sent — MIME, constructor, byte length — and never the contents. Knowing a POST carried 480 KB of
 * `audio/webm` is the whole finding; knowing what was said would make the artifact the leak.
 */

/**
 * Injected verbatim via `Page.addScriptToEvaluateOnNewDocument`, so it wins the race against every
 * `fetch` the app makes at boot. Wrapping after load would miss exactly the early traffic.
 */
// Stringified into the injected producer: no closure input, payload or field-name output.
function inspectTripwireBody(body, contentType) {
  const MAX = 262144, FIELDS = 128;
  const budget = { chars: 0, nodes: 0, fields: 0, encoded: 0, scalarEncoded: 0 };
  const audioField = /^(audio|audioData|audio_data|audioBytes|audio_bytes|pcm|pcmData|pcm_data|samples|audioSamples|audio_samples)$/i;
  const opaque = () => ({ kind: 'unknown', mime: null, bytes: -1, encoded: 0 });
  // Within-envelope fragments are checked together. Cross-message state is only for complete
  // scalar frames; unrelated JSON metadata identifiers must not add up to a fabricated audio stream.
  const shaped = (kind, bytes = -1, mime = null) => ({ kind, mime, bytes, encoded: budget.scalarEncoded });
  const charge = value => {
    budget.chars += value.length;
    if (value.length > MAX || budget.chars > MAX) throw new Error('bound');
  };
  const encodedToken = text => {
    const match = /^([a-z0-9+/_-]+)(={0,2})$/i.exec(text);
    if (!match) return false;
    const remainder = match[1].length % 4;
    return match[2].length === 2 ? remainder === 2 : match[2].length === 1 ? remainder === 3 : remainder !== 1;
  };
  const textShape = (value, depth, audioContext = false, scalar = false) => {
    if (++budget.nodes > 256 || depth > 6) throw new Error('bound');
    charge(value);
    const text = value.trim();
    if (/^data:(audio|video)\//i.test(text)) return true;
    if (text.startsWith('{') || text.startsWith('[') || text.startsWith('"')) {
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new Error('json'); }
      return inspect(parsed, depth + 1, audioContext, typeof parsed === 'string');
    }
    if (/%[a-f0-9]{2}/i.test(text)) {
      let decoded;
      try { decoded = decodeURIComponent(text); } catch { throw new Error('encoding'); }
      if (decoded !== text) return textShape(decoded, depth + 1, audioContext, scalar);
    }
    if (text.length >= (audioContext || scalar ? 4 : 32) && encodedToken(text)) {
      budget.encoded += text.length;
      if (scalar) budget.scalarEncoded += text.length;
    }
    return budget.encoded >= 256;
  };
  const inspect = (value, depth = 0, audioContext = false, scalar = false) => {
    if (++budget.nodes > 256 || depth > 6) throw new Error('bound');
    if (typeof value === 'string') return textShape(value, depth, audioContext, scalar);
    if (value === null || typeof value === 'boolean' || typeof value === 'number') return false;
    if (!value || typeof value !== 'object') throw new Error('shape');
    if (Array.isArray(value)) {
      if (value.length > FIELDS) throw new Error('bound');
      const items = [];
      for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !('value' in descriptor)) throw new Error('accessor');
        items.push(descriptor.value);
      }
      if (items.length >= 32 && items.every(item => typeof item === 'number' && Number.isFinite(item))) return true;
      for (const item of items) if (inspect(item, depth + 1, audioContext)) return true;
      return false;
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('prototype');
    let numeric = true, indices = 0;
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (++budget.fields > FIELDS) throw new Error('bound');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) throw new Error('accessor');
      numeric = numeric && key === String(indices) && typeof descriptor.value === 'number' && Number.isFinite(descriptor.value);
      indices++;
      if (textShape(key, depth + 1)) return true;
      const fieldAudio = audioContext || audioField.test(key);
      if (fieldAudio && descriptor.value !== null && descriptor.value !== '' && descriptor.value !== false) return true;
      if (inspect(descriptor.value, depth + 1, fieldAudio)) return true;
    }
    return indices >= 32 && numeric;
  };
  try {
    if (contentType != null && (typeof contentType !== 'string' || contentType.length > 128)) return opaque();
    if (body === null || body === undefined) return shaped('empty', 0);
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
      if (!Number.isSafeInteger(body.size) || body.size > MAX) return opaque();
      if (/^(audio|video)\//i.test(body.type)) return shaped('audio', body.size,
        ['audio/webm','audio/wav','audio/ogg','video/webm'].includes(body.type) ? body.type : 'audio/unknown');
      return body.size ? shaped('binary', body.size) : shaped('empty', 0);
    }
    if (ArrayBuffer.isView(body)) {
      if (body.byteLength > MAX) return opaque();
      return shaped(typeof Float32Array !== 'undefined' && body instanceof Float32Array ? 'audio' : 'binary', body.byteLength);
    }
    if (body instanceof ArrayBuffer) return body.byteLength > MAX ? opaque() : shaped('binary', body.byteLength);
    if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return shaped('opaque_stream');
    const fields = (entries, multipart) => {
      for (const [key, value] of entries) {
        if (++budget.fields > FIELDS || typeof key !== 'string') return opaque();
        if (textShape(key, 0)) return shaped('encoded_audio');
        if (typeof Blob !== 'undefined' && value instanceof Blob) {
          if (value.size > MAX) return opaque();
          if (/^(audio|video)\//i.test(value.type)) return shaped('audio', value.size, 'audio/unknown');
          if (value.size) return opaque();
        } else if (typeof value !== 'string') return opaque();
        else if ((audioField.test(key) && value.trim()) || textShape(value, 0, audioField.test(key))) return shaped('encoded_audio');
      }
      return shaped('form', -1, multipart ? 'multipart/form-data' : 'application/x-www-form-urlencoded');
    };
    if (typeof FormData !== 'undefined' && body instanceof FormData) return fields(body.entries(), true);
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return fields(body.entries(), false);
    if (typeof body === 'string') {
      if (body.length > MAX) return opaque();
      if (typeof contentType === 'string' && /^application\/json(?:;|$)/i.test(contentType)) {
        charge(body);
        let value;
        try { value = JSON.parse(body); } catch { return opaque(); }
        return shaped(inspect(value, 0, false, typeof value === 'string') ? 'encoded_audio' : 'json', new TextEncoder().encode(body).byteLength, 'application/json');
      }
      // A JSON scalar stays inspectable even if a transport's HeadersInit does not expose MIME.
      // Never let quoted base64 borrow an ordinary-text verdict.
      if (/^[{["]/.test(body.trim())) {
        return shaped(textShape(body, 0, false, true) ? 'encoded_audio' : 'text', new TextEncoder().encode(body).byteLength);
      }
      const formMime = typeof contentType === 'string' && /^application\/x-www-form-urlencoded(?:;|$)/i.test(contentType);
      const token = body.trim();
      // Complete padded scalars must win before MIME-inferred form parsing: AQ== and AQI=
      // are one quantum each, not harmless empty form fields. Explicit form MIME cannot settle
      // this whole-body ambiguity either; retain opaque evidence rather than a false-clean form.
      if (token.length >= 4 && encodedToken(token)) {
        if (formMime) return opaque();
        return shaped(textShape(body, 0, false, true) ? 'encoded_audio' : 'text', new TextEncoder().encode(body).byteLength);
      }
      if (formMime || body.includes('=')) {
        // Input length is checked before parsing can allocate a field collection.
        let fieldsSeen = 1;
        for (const char of body) if (char === '&' && ++fieldsSeen > FIELDS) return opaque();
        const result = fields(new URLSearchParams(body).entries(), false);
        // Shape inference is not proof of the outgoing MIME header.
        if (!formMime) result.mime = null;
        return result;
      }
      const audio = textShape(body, 0, false, true);
      return shaped(audio ? 'encoded_audio' : 'text', new TextEncoder().encode(body).byteLength);
    }
    // An arbitrary object is not a JSON BodyInit. Native transports may invoke custom coercion;
    // never borrow a clean JSON verdict from inspecting a different representation.
    return opaque();
  } catch { return opaque(); }
}

export const PAYLOAD_TRIPWIRE = `(() => {
  // globalThis, NOT window. A worker has no window and no document, so the first line threw and the
  // whole installer aborted -- silently, because an injected script's exception goes nowhere. The
  // observer then reported zero audio egress from workers having never installed in one: the context
  // that actually holds PCM, unwatched and scored clean.
  const w = globalThis;
  if (w.__SS_TRIPWIRE__) return;
  const records = [];
  w.__SS_TRIPWIRE__ = records;

  const boundedInspect = (${inspectTripwireBody.toString()});
  const encodedState = new Map();
  const classify = (body, mime) => boundedInspect(body, mime);
  const failNote = transport => {
    const row = { t: Date.now(), transport, url: '', method: 'UNKNOWN', kind: 'unknown', mime: null, bytes: -1, runtimeState: null };
    if (records.length >= 512) records[511] = row;
    else records.push(row);
  };
  const note = (transport, url, method, body, extraMime) => {
    try {
      if (records.length >= 512) { failNote(transport); return; }
      const raw = String(url || '');
      if (raw.length > 4096) { failNote(transport); return; }
      const origin = new URL(raw, w.location && w.location.href).origin;
      const c = classify(body, extraMime);
      if (c.kind === 'unknown') { failNote(transport); return; }
      if (c.encoded > 0) {
        const key = transport + ':' + origin;
        if (!encodedState.has(key) && encodedState.size >= 64) { failNote(transport); return; }
        const count = Math.min(256, (encodedState.get(key) || 0) + c.encoded);
        encodedState.set(key, count);
        if (count >= 256) c.kind = 'encoded_audio';
      }
      const rawState = (typeof document !== 'undefined' && document.documentElement)
        ? document.documentElement.getAttribute('data-runtime-state') : null;
      const state = ['READY','RECORDING','STOPPING','PROCESSING','SAVING','ERROR'].includes(rawState) ? rawState : null;
      const verb = String(method || 'GET').toUpperCase();
      records.push({
        // WHEN, so "during the take" can be decided per record rather than for the whole run. Without
        // it a single end-of-run flag applied retroactively to startup traffic.
        t: Date.now(),
        transport,
        // Payload audit retains the destination origin only. The independent network audit owns routes.
        url: origin,
        method: ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','SEND'].includes(verb) ? verb : 'UNKNOWN',
        kind: c.kind,
        mime: c.mime,
        bytes: c.bytes,
        // Absent in a worker; the main-document record carries the phase and findings are correlated
        // by time, so a worker record reports null rather than failing to record at all.
        runtimeState: state,
      });
    } catch { failNote(transport); }
  };

  const origFetch = w.fetch;
  if (origFetch) {
    w.fetch = function (input, init) {
      try {
        // A URL object stringifies to its href; only the sanitized projection is ever retained.
        const url = typeof input === 'string' ? input
          : (input && typeof input === 'object' && 'href' in input) ? String(input)
            : (input && input.url);
        const method = (init && init.method) || (input && input.method) || 'GET';
        const headerMime = init && init.headers && typeof init.headers === 'object'
          ? (typeof Headers !== 'undefined' && init.headers instanceof Headers ? init.headers.get('content-type')
            : init.headers['Content-Type'] || init.headers['content-type'] || null) : null;

        // REQUEST BODIES WERE INVISIBLE. Only \`init.body\` was read, so
        // \`fetch(new Request(url, { body: audioBlob }))\` recorded an empty payload and produced a clean
        // receipt for a request carrying audio. A Request's body is a stream that cannot be read here
        // without consuming it and breaking the app, so it is reported as opaque and fails closed.
        let body = init && init.body;
        let mime = headerMime;
        if (body === undefined || body === null) {
          const isRequest = typeof Request !== 'undefined' && input instanceof Request;
          if (isRequest) {
            try { mime = mime || input.headers.get('content-type'); } catch (e) { void e; }
            if (input.body) body = { __ss_opaque_request_body: true };
            else if (input.bodyUsed) body = { __ss_opaque_request_body: true };
          }
        }
        if (body && body.__ss_opaque_request_body) {
          note('fetch', url, method, undefined, mime);
          records[records.length - 1].kind = 'opaque_stream';
          records[records.length - 1].bytes = -1;
        } else {
          note('fetch', url, method, body, mime);
        }
      } catch { failNote('fetch'); }
      return origFetch.apply(this, arguments);
    };
  }

  const XHR = w.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function (method, url) { this.__ss_m = method; this.__ss_u = url; return open.apply(this, arguments); };
    XHR.prototype.send = function (body) { note('xhr', this.__ss_u, this.__ss_m, body); return send.apply(this, arguments); };
  }

  if (w.navigator && typeof w.navigator.sendBeacon === 'function') {
    const beacon = w.navigator.sendBeacon.bind(w.navigator);
    w.navigator.sendBeacon = function (url, data) { note('beacon', url, 'POST', data); return beacon(url, data); };
  }

  const WS = w.WebSocket;
  if (WS) {
    const Wrapped = function (url, protocols) {
      const socket = protocols === undefined ? new WS(url) : new WS(url, protocols);
      const send = socket.send.bind(socket);
      socket.send = function (data) { note('websocket', url, 'SEND', data); return send(data); };
      return socket;
    };
    Wrapped.prototype = WS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k) => { Wrapped[k] = WS[k]; });
    w.WebSocket = Wrapped;
  }
})()`;

/**
 * Read what the tripwire collected.
 *
 * `globalThis`, for the same reason the installer uses it: this said `window`, so in a worker the read
 * expression threw and was swallowed by the caller's catch. The install had succeeded, the records
 * existed, and the observer reported none of them — a silent zero that looked exactly like a clean run.
 * Two expressions, the same wrong assumption, and either one alone was enough to make the worker
 * evidence disappear.
 */
export const READ_TRIPWIRE = 'JSON.stringify(globalThis.__SS_TRIPWIRE__ || [])';

/**
 * Read-only collector used by the actual diagnostic CLI. A readable snapshot is not a terminal
 * emission count. Until a separately qualified closure channel exists, every owned worker remains
 * incomplete, including a quiet worker and a worker whose final read succeeded.
 */
export function createWorkerReadCollector({ client, installedSessions, readBudgetMs = 2500 }) {
  if (!Number.isSafeInteger(readBudgetMs) || readBudgetMs < 1 || readBudgetMs > 2500) {
    throw new Error('invalid worker read budget');
  }
  // Readback is untrusted even when the normal injected producer has a closed output schema.
  // A field-name whitelist alone would still retain secrets placed in recognized string fields.
  const fields = ['t', 'transport', 'url', 'method', 'kind', 'mime', 'bytes', 'runtimeState'];
  const transports = new Set(['fetch', 'xhr', 'beacon', 'websocket']);
  const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'SEND', 'UNKNOWN']);
  const states = new Set(['READY', 'RECORDING', 'STOPPING', 'PROCESSING', 'SAVING', 'ERROR']);
  const mimes = {
    empty: [null], text: [null], binary: [null], opaque_stream: [null], unknown: [null],
    json: ['application/json'],
    // Accumulated scalar form frames are promoted without changing the producer's original MIME.
    encoded_audio: [null, 'application/json', 'multipart/form-data', 'application/x-www-form-urlencoded'],
    form: [null, 'multipart/form-data', 'application/x-www-form-urlencoded'],
    audio: [null, 'audio/webm', 'audio/wav', 'audio/ogg', 'video/webm', 'audio/unknown'],
  };
  const validateRecord = row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).length !== fields.length || fields.some(key => !Object.hasOwn(row, key))) {
      throw new Error('invalid worker schema');
    }
    if (!transports.has(row.transport) || !methods.has(row.method)
      || typeof row.kind !== 'string' || !Object.hasOwn(mimes, row.kind)
      || !mimes[row.kind].includes(row.mime)
      || (row.runtimeState !== null && !states.has(row.runtimeState))) {
      throw new Error('invalid worker enum');
    }
    if (!Number.isSafeInteger(row.t) || row.t < 0 || row.t > 8640000000000000
      || !Number.isSafeInteger(row.bytes) || row.bytes < -1 || row.bytes > 1048576) {
      throw new Error('invalid worker count');
    }
    if ((row.kind === 'empty' && row.bytes !== 0)
      || (['form', 'opaque_stream', 'unknown'].includes(row.kind) && row.bytes !== -1)
      || (['text', 'json', 'audio', 'binary', 'empty'].includes(row.kind) && row.bytes < 0)
      || (['audio', 'binary'].includes(row.kind) && row.bytes > 262144)) {
      throw new Error('inconsistent worker metadata');
    }
    if (typeof row.url !== 'string' || row.url.length > 4096) throw new Error('invalid worker URL');
    let origin = '';
    if (row.kind === 'unknown') {
      if (row.url !== '' || row.method !== 'UNKNOWN' || row.runtimeState !== null) {
        throw new Error('invalid worker failure sentinel');
      }
    } else {
      const url = new URL(row.url);
      const schemes = row.transport === 'websocket' ? ['ws:', 'wss:'] : ['http:', 'https:'];
      if (!schemes.includes(url.protocol) || url.username || url.password || url.origin === 'null') {
        throw new Error('invalid worker URL');
      }
      // Discard the path/query/fragment before retaining the value, even if a compromised readback
      // supplied a complete URL rather than the normal producer's origin-only projection.
      origin = url.origin;
    }
    return { t: row.t, transport: row.transport, url: origin, method: row.method,
      kind: row.kind, mime: row.mime, bytes: row.bytes, runtimeState: row.runtimeState };
  };
  const workerRecords = new Map();
  const drainStatus = new Map();
  const postReadDrainFailures = new Set();
  let sealed = null;
  let finishing = null;
  let phase = 'OPEN';
  let activeDrains = 0;
  let pendingAtFinish = false;
  let ownershipChanged = false;
  let capExceeded = false;
  const readWorkers = async (expectedPhase) => {
    const sessions = [...installedSessions];
    if (sessions.length > 32) { capExceeded = true; return; }
    const deadline = Date.now() + readBudgetMs;
    for (const sessionId of sessions) {
      if (phase !== expectedPhase) return;
      let timer;
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('worker read deadline');
        const evaluated = await Promise.race([
          client.send('Runtime.evaluate', {
            expression: READ_TRIPWIRE, returnByValue: true, awaitPromise: false,
          }, sessionId),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('worker read deadline')), remaining); }),
        ]);
        if (phase !== expectedPhase) return;
        if (evaluated?.exceptionDetails) throw new Error('worker readback threw');
        if (typeof evaluated?.result?.value !== 'string') throw new Error('worker readback returned no value');
        if (evaluated.result.value.length > 262144) throw new Error('worker readback over bound');
        const parsed = JSON.parse(evaluated.result.value);
        if (!Array.isArray(parsed) || parsed.length > 512) throw new Error('invalid worker records');
        // Validate the complete batch before publishing any row. Errors retain only failure counts;
        // neither rejected values nor URL/parser error text enters the receipt.
        const rows = parsed.map(validateRecord);
        if (rows.length > 0) workerRecords.set(sessionId, rows);
        drainStatus.set(sessionId, true);
      } catch {
        if (phase !== expectedPhase) return;
        if (drainStatus.get(sessionId) === true) postReadDrainFailures.add(sessionId);
        // An earlier read cannot exclude sends made after it. A final failure is never rewritten as
        // ordinary teardown merely because an earlier poll succeeded.
        drainStatus.set(sessionId, false);
      } finally {
        clearTimeout(timer);
      }
    }
    if (sessions.length !== installedSessions.size || sessions.some(id => !installedSessions.has(id))) ownershipChanged = true;
  };
  const drain = async () => {
    if (phase !== 'OPEN') return;
    activeDrains += 1;
    try { await readWorkers('OPEN'); } finally { activeDrains -= 1; }
  };
  const finish = () => {
    if (sealed) return sealed;
    if (finishing) return finishing;
    pendingAtFinish = activeDrains > 0;
    phase = 'FINISHING';
    finishing = (async () => {
      await readWorkers('FINISHING');
      phase = 'SEALED';
      const payloads = Object.freeze([...workerRecords.values()].flat()
        .map(p => Object.freeze({ ...p, context: 'worker' })));
      const instrumentation = Object.freeze({
        // No code path here establishes finalN or complete acknowledged sequence 1..N.
        terminalCompleteness: 'UNPROVEN', finalEmissionCount: null,
        drained: 0, drainFailures: installedSessions.size,
        finalReadFailures: [...installedSessions].filter(id => drainStatus.get(id) !== true).length,
        postReadFailures: postReadDrainFailures.size,
        workerReadPending: pendingAtFinish, workerOwnershipChanged: ownershipChanged,
        workerStateCapExceeded: capExceeded,
      });
      sealed = Object.freeze({ payloads, instrumentation });
      return sealed;
    })();
    return finishing;
  };
  return Object.freeze({ drain, finish });
}
