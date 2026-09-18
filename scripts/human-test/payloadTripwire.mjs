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
export const PAYLOAD_TRIPWIRE = `(() => {
  // globalThis, NOT window. A worker has no window and no document, so the first line threw and the
  // whole installer aborted -- silently, because an injected script's exception goes nowhere. The
  // observer then reported zero audio egress from workers having never installed in one: the context
  // that actually holds PCM, unwatched and scored clean.
  const w = globalThis;
  if (w.__SS_TRIPWIRE__) return;
  const records = [];
  w.__SS_TRIPWIRE__ = records;

  // A Private-STT worker is deliberately torn down as part of a successful Stop. Reading its retained
  // Playwright Worker handle after the save therefore races a terminated execution context. Relay each
  // metadata-only record while the worker is alive; the document forwards it to the already-exposed
  // Playwright binding, so teardown cannot erase evidence that was observed before the final verdict.
  const hasDocument = typeof document !== 'undefined';
  const isDocument = typeof window !== 'undefined' && w === window && hasDocument;
  const isWorker = typeof WorkerGlobalScope !== 'undefined' && w instanceof WorkerGlobalScope;
  const relayMarker = '__speaksharp_canary_payload_v1__';
  const workerId = isWorker
    ? 'worker-' + Date.now() + '-' + Math.random().toString(36).slice(2)
    : null;
  let emitChain = Promise.resolve();
  const relayStates = new Map();
  const receivedSequences = new Set();
  const acknowledgedSequences = new Set();
  let relayDrainFailure = null;
  let relay = null;
  if ((isDocument || isWorker) && typeof BroadcastChannel === 'function') {
    try { relay = new BroadcastChannel(relayMarker); } catch (e) { void e; }
  }

  // Production is cross-origin isolated (COOP + COEP), so a shared atomic counter can identify the
  // exact final sequence without delaying Worker.terminate(). Each worker increments before posting a
  // metadata record; after synchronous teardown the counter is immutable and the document can wait for
  // every numbered record and binding acknowledgement explicitly.
  let relayCounter = null;
  if (isDocument && relay && typeof SharedArrayBuffer === 'function' && typeof Atomics === 'object') {
    try { relayCounter = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)); }
    catch (error) { relayDrainFailure = error instanceof Error ? error.message : 'payload counter unavailable'; }
  }
  let resolveRelayReady = () => {};
  w.__SS_TRIPWIRE_READY_PROMISE__ = isWorker
    ? new Promise((resolve) => { resolveRelayReady = resolve; })
    : Promise.resolve();
  w.__SS_TRIPWIRE_RELAY_READY__ = isDocument ? relay !== null && relayCounter !== null : false;

  const emitRecord = (record) => {
    if (typeof w.__SS_TRIPWIRE_EMIT__ !== 'function') return Promise.resolve();
    let emitted;
    try { emitted = w.__SS_TRIPWIRE_EMIT__(record); }
    catch (error) {
      relayDrainFailure = error instanceof Error ? error.message : 'payload binding failed';
      return Promise.resolve();
    }
    const pending = Promise.resolve(emitted).catch((error) => {
      relayDrainFailure = error instanceof Error ? error.message : 'payload binding failed';
    });
    emitChain = Promise.all([emitChain, pending]).then(() => undefined);
    return pending;
  };

  const emitChannelRecord = (record) => {
    if (typeof w.__SS_TRIPWIRE_CHANNEL_EMIT__ !== 'function') return Promise.resolve();
    let emitted;
    try { emitted = w.__SS_TRIPWIRE_CHANNEL_EMIT__(record); }
    catch (error) {
      relayDrainFailure = error instanceof Error ? error.message : 'channel binding failed';
      return Promise.resolve();
    }
    const pending = Promise.resolve(emitted).catch((error) => {
      relayDrainFailure = error instanceof Error ? error.message : 'channel binding failed';
    });
    emitChain = Promise.all([emitChain, pending]).then(() => undefined);
    return pending;
  };

  if (isDocument && relay) {
    relay.addEventListener('message', (event) => {
      try {
        const data = event && event.data;
        if (!data || data.marker !== relayMarker || typeof data.workerId !== 'string') return;
        const state = relayStates.get(data.workerId) || { counterReady: false };
        relayStates.set(data.workerId, state);
        if (data.type === 'worker_ready') {
          if (!relayCounter) {
            relayDrainFailure = 'payload shared counter unavailable';
            relay.postMessage({ marker: relayMarker, type: 'counter_unavailable', workerId: data.workerId });
            return;
          }
          relay.postMessage({
            marker: relayMarker,
            type: 'counter_offer',
            workerId: data.workerId,
            counter: relayCounter.buffer,
          });
          return;
        }
        if (data.type === 'counter_ready') {
          state.counterReady = true;
          return;
        }
        if (data.type === 'relay_failure') {
          relayDrainFailure = 'worker payload relay emitted without a shared counter';
          return;
        }
        if ((data.type === 'record' || data.type === 'channel')
          && Number.isInteger(data.sequence) && data.sequence > 0) {
          receivedSequences.add(data.sequence);
          const pending = data.type === 'channel'
            ? emitChannelRecord({ ...data.record, __ssSource: 'worker' })
            : emitRecord({ ...data.record, __ssSource: 'worker' });
          void pending.then(() => {
            acknowledgedSequences.add(data.sequence);
          });
        }
      } catch (e) { void e; }
    });

    let terminatedWorkers = 0;
    const terminatedWorkerRefs = new WeakSet();
    if (typeof Worker === 'function' && Worker.prototype && typeof Worker.prototype.terminate === 'function') {
      const terminate = Worker.prototype.terminate;
      Worker.prototype.terminate = function (...args) {
        // Observe teardown without postponing it: the native call completes before any bookkeeping.
        const result = terminate.apply(this, args);
        if (!terminatedWorkerRefs.has(this)) {
          terminatedWorkerRefs.add(this);
          terminatedWorkers += 1;
        }
        return result;
      };
    }

    w.__SS_TRIPWIRE_DRAIN__ = async (expectedWorkers) => {
      const expectedWorkerCount = Number(expectedWorkers || 0);
      if (relayDrainFailure) throw new Error(relayDrainFailure);
      if (!relayCounter) throw new Error('payload shared counter unavailable');
      if (relayStates.size < expectedWorkerCount) {
        throw new Error('payload relay worker registration incomplete');
      }
      if (Array.from(relayStates.values()).some((state) => state.counterReady !== true)) {
        throw new Error('payload relay counter handshake incomplete');
      }
      if (terminatedWorkers < expectedWorkerCount) {
        throw new Error('payload worker teardown incomplete');
      }

      // Native termination has completed, so no worker can increment again. This is the authoritative
      // final sequence, not an elapsed-time guess. Wait until every numbered record has crossed the
      // BroadcastChannel and its metadata-only binding promise has acknowledged.
      const finalSequence = Atomics.load(relayCounter, 0);
      const deadline = Date.now() + 5000;
      while (receivedSequences.size < finalSequence || acknowledgedSequences.size < finalSequence) {
        if (Date.now() >= deadline) throw new Error('payload final sequence was not acknowledged');
        await new Promise((resolve) => setTimeout(resolve, 10));
        await emitChain;
      }
      for (let sequence = 1; sequence <= finalSequence; sequence += 1) {
        if (!receivedSequences.has(sequence) || !acknowledgedSequences.has(sequence)) {
          throw new Error('payload relay sequence gap');
        }
      }
      await emitChain;
      if (relayDrainFailure) throw new Error(relayDrainFailure);
      return {
        workers: relayStates.size,
        received: receivedSequences.size,
        acknowledged: acknowledgedSequences.size,
      };
    };
  }

  if (isWorker && relay) {
    relay.addEventListener('message', (event) => {
      try {
        const data = event && event.data;
        if (!data || data.marker !== relayMarker || data.workerId !== workerId) return;
        if (data.type === 'counter_unavailable') {
          w.__SS_TRIPWIRE_RELAY_READY__ = false;
          resolveRelayReady(false);
          return;
        }
        if (data.type !== 'counter_offer' || !(data.counter instanceof SharedArrayBuffer)) return;
        relayCounter = new Int32Array(data.counter);
        w.__SS_TRIPWIRE_RELAY_READY__ = true;
        relay.postMessage({ marker: relayMarker, type: 'counter_ready', workerId });
        resolveRelayReady(true);
      } catch (error) {
        w.__SS_TRIPWIRE_RELAY_READY__ = false;
        resolveRelayReady(false);
      }
    });
    relay.postMessage({ marker: relayMarker, type: 'worker_ready', workerId });
  }

  const isNumericSampleArray = (value) => Array.isArray(value)
    && value.length >= 32
    && value.every((sample) => typeof sample === 'number' && Number.isFinite(sample));

  const isEncodedAudioText = (value) => {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    // Inspect only the shape in-page; never retain or relay the value. A whole-body audio data URL,
    // canonical base64 byte string, or numeric JSON sample array is opaque audio-shaped data, not
    // ordinary transcript/telemetry text. Encoding audio must not authorize its transport.
    if (/^data:(audio|video)\\/[a-z0-9.+-]+;base64,/i.test(trimmed)) return true;
    const unpadded = trimmed.replace(/={1,2}$/, '');
    if (trimmed.length >= 256 && unpadded.length % 4 !== 1
      && /^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) return true;
    if (trimmed.length >= 64 && trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try { return isNumericSampleArray(JSON.parse(trimmed)); } catch (e) { void e; }
    }
    return false;
  };

  const shortEncodedAudioTextLength = (value) => {
    if (typeof value !== 'string') return 0;
    const trimmed = value.trim();
    // Four characters is one complete base64 quantum. Do not impose a larger per-frame floor: an
    // uploader controls its framing and could otherwise split below that floor forever.
    if (trimmed.length < 4 || trimmed.length >= 256) return 0;
    const unpadded = trimmed.replace(/={1,2}$/, '');
    return unpadded.length % 4 !== 1 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)
      ? trimmed.length : 0;
  };

  // Property names and generic JSON values need a modest per-fragment floor so ordinary identifiers
  // (for example safe_0) cannot add up to an audio verdict. The reviewed evasion uses substantial
  // base64 chunks split across key/value; audio-labelled fields retain the stricter four-character floor.
  const shortEncodedAudioPropertyLength = (value) => {
    const chars = shortEncodedAudioTextLength(value);
    return chars >= 32 ? chars : 0;
  };

  const isAudioField = (key) => /^(audio|audioData|audio_data|audioBytes|audio_bytes|pcm|pcmData|pcm_data|samples|audioSamples|audio_samples)$/i.test(key);

  const isEncodedAudioChunkArray = (value) => {
    if (!Array.isArray(value) || value.length < 2) return false;
    let encodedChars = 0;
    for (const chunk of value) {
      if (typeof chunk !== 'string') return false;
      const trimmed = chunk.trim();
      if (!trimmed || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) return false;
      encodedChars += trimmed.length;
    }
    // Judge the logical audio field as one payload. Per-chunk thresholds let a caller split an
    // otherwise recognizable base64 body into arbitrarily small pieces and receive a clean verdict.
    return encodedChars >= 256;
  };

  const isNumericSampleObject = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const entries = Object.entries(value);
    return entries.length >= 32 && entries.every(([key, sample], index) => (
      key === String(index) && typeof sample === 'number' && Number.isFinite(sample)
    ));
  };

  const inspectEncodedAudio = (value, depth, budget, audioContext) => {
    // A bounded inspection may conclude AUDIO or CLEAN only when it actually saw enough of the
    // value to justify that verdict. Reaching either bound is OPAQUE, never a clean certificate.
    if (depth > 4 || budget.remaining <= 0) return 'opaque';
    budget.remaining -= 1;
    if (audioContext && (isEncodedAudioText(value) || isNumericSampleArray(value)
      || isEncodedAudioChunkArray(value) || isNumericSampleObject(value))) return 'audio';
    if (!value || typeof value !== 'object') return 'clean';
    let verdict = 'clean';
    if (Array.isArray(value)) {
      if (audioContext && isNumericSampleArray(value)) return 'audio';
      for (const entry of value) {
        const nested = inspectEncodedAudio(entry, depth + 1, budget, audioContext);
        if (nested === 'audio') return 'audio';
        if (nested === 'opaque') verdict = 'opaque';
      }
      return verdict;
    }
    let genericKeyValueChars = 0;
    for (const [key, nested] of Object.entries(value)) {
      if (isEncodedAudioText(key)) return 'audio';
      genericKeyValueChars += shortEncodedAudioPropertyLength(key);
      if (typeof nested === 'string') genericKeyValueChars += shortEncodedAudioPropertyLength(nested);
      if (genericKeyValueChars >= 256) return 'audio';
      const nestedAudioContext = audioContext || isAudioField(key);
      if (nestedAudioContext && (isEncodedAudioText(nested)
        || isNumericSampleArray(nested) || isNumericSampleObject(nested))) return 'audio';
      if (nested && typeof nested === 'object') {
        const inspected = inspectEncodedAudio(nested, depth + 1, budget, nestedAudioContext);
        if (inspected === 'audio') return 'audio';
        if (inspected === 'opaque') verdict = 'opaque';
      }
    }
    return verdict;
  };

  const inspectEncodedAudioEnvelopeText = (value) => {
    if (typeof value !== 'string') return 'clean';
    const trimmed = value.trim();
    // Bound parsing by bytes, depth, and visited nodes. Only recognized audio-bearing keys are treated
    // as audio, so ordinary telemetry identifiers or unrelated base64 text do not become false holds.
    if (trimmed.length < 2
      || !((trimmed.startsWith('{') && trimmed.endsWith('}'))
        || (trimmed.startsWith('[') && trimmed.endsWith(']')))) return 'clean';
    if (trimmed.length > 1_000_000) return 'opaque';
    try { return inspectEncodedAudio(JSON.parse(trimmed), 0, { remaining: 128 }, false); }
    // Once a value has the shape of a JSON envelope, a parse failure is incomplete evidence. JSONL,
    // concatenated values, or a truncated body can still carry audio, so ambiguity is opaque/blocking.
    catch (e) { void e; return 'opaque'; }
  };

  const countShortEncodedAudioCandidates = (value, depth, budget, audioContext) => {
    if (depth > 4 || budget.remaining <= 0) return 0;
    budget.remaining -= 1;
    if (audioContext && typeof value === 'string') return shortEncodedAudioTextLength(value);
    if (!value || typeof value !== 'object') return 0;
    let chars = 0;
    if (Array.isArray(value)) {
      for (const entry of value) {
        chars += countShortEncodedAudioCandidates(entry, depth + 1, budget, audioContext);
      }
      return chars;
    }
    let genericKeyValueChars = 0;
    for (const [key, nested] of Object.entries(value)) {
      genericKeyValueChars += shortEncodedAudioPropertyLength(key);
      if (typeof nested === 'string') genericKeyValueChars += shortEncodedAudioPropertyLength(nested);
      chars += countShortEncodedAudioCandidates(
        nested, depth + 1, budget, audioContext || isAudioField(key),
      );
    }
    return chars + (genericKeyValueChars >= 256 ? genericKeyValueChars : 0);
  };

  const shortEncodedAudioEnvelopeChars = (value) => {
    if (typeof value !== 'string') return 0;
    const trimmed = value.trim();
    if (trimmed.length < 2 || trimmed.length > 1_000_000
      || !((trimmed.startsWith('{') && trimmed.endsWith('}'))
        || (trimmed.startsWith('[') && trimmed.endsWith(']')))) return 0;
    try {
      return countShortEncodedAudioCandidates(JSON.parse(trimmed), 0, { remaining: 128 }, false);
    } catch (e) { void e; return 0; }
  };

  const classify = (body) => {
    if (body === null || body === undefined) return { kind: 'empty', mime: null, bytes: 0 };
    if (typeof body === 'string') {
      const envelope = inspectEncodedAudioEnvelopeText(body);
      const candidateChars = shortEncodedAudioTextLength(body)
        || shortEncodedAudioEnvelopeChars(body);
      return {
        kind: isEncodedAudioText(body) || envelope === 'audio'
          ? 'encoded_audio' : envelope === 'opaque' ? 'blob' : 'text',
        mime: null,
        bytes: body.length,
        candidateChars,
      };
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
      const mime = body.type || '';
      // A MediaRecorder chunk is a Blob whose type is audio/* or video/* — the direct evidence that
      // captured audio is being handed to a transport.
      const kind = /^(audio|video)\\//.test(mime) ? 'audio' : (mime ? 'blob' : 'binary');
      return { kind, mime: mime || null, bytes: body.size };
    }
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      let audio = false; let opaque = false; let bytes = 0; let candidateChars = 0;
      try {
        for (const [key, value] of body.entries()) {
          bytes += key.length + value.length;
          const envelope = inspectEncodedAudioEnvelopeText(value);
          if ((isAudioField(key) && value.trim().length > 0)
            || isEncodedAudioText(value) || envelope === 'audio') audio = true;
          else if (envelope === 'opaque') opaque = true;
          else candidateChars += shortEncodedAudioTextLength(value)
            || shortEncodedAudioEnvelopeChars(value);
        }
      } catch (e) { void e; bytes = -1; }
      return {
        kind: audio || candidateChars >= 256 ? 'encoded_audio' : opaque ? 'blob' : 'form',
        mime: 'application/x-www-form-urlencoded',
        bytes,
        candidateChars,
      };
    }
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      let audio = false; let opaqueBinary = false; let bytes = 0; let candidateChars = 0;
      try {
        for (const [key, v] of body.entries()) {
          const namedAudio = isAudioField(key);
          if (typeof Blob !== 'undefined' && v instanceof Blob) {
            bytes += v.size;
            if (v.size > 0) {
              if (namedAudio || /^(audio|video)\\//.test(v.type || '')) audio = true;
              // Multipart is only a wrapper. A caller-controlled field name or MIME must not turn the
              // same opaque Blob that fails closed on its own into benign \`form\` traffic. Keep the
              // aggregate metadata-only: do not retain the field name, MIME, or value.
              else opaqueBinary = true;
            }
          } else if (typeof v === 'string') {
            bytes += v.length;
            const envelope = inspectEncodedAudioEnvelopeText(v);
            if ((namedAudio && v.trim().length > 0)
              || isEncodedAudioText(v) || envelope === 'audio') audio = true;
            else if (envelope === 'opaque') opaqueBinary = true;
            else candidateChars += shortEncodedAudioTextLength(v)
              || shortEncodedAudioEnvelopeChars(v);
          }
        }
      } catch (e) { void e; }
      return {
        kind: audio || candidateChars >= 256 ? 'audio' : opaqueBinary ? 'blob' : 'form',
        mime: 'multipart/form-data',
        bytes,
        candidateChars,
      };
    }
    if (ArrayBuffer.isView(body)) {
      // Float32Array is what the capture pipeline holds: raw PCM. Any typed array leaving the page is
      // unexplained binary at best.
      const ctor = body.constructor && body.constructor.name;
      return { kind: ctor === 'Float32Array' ? 'audio' : 'binary', mime: null, bytes: body.byteLength, ctor };
    }
    if (body instanceof ArrayBuffer) return { kind: 'binary', mime: null, bytes: body.byteLength };
    // A STREAM CANNOT BE INSPECTED WITHOUT CONSUMING IT, so it is reported as opaque rather than
    // falling through to the object branch, where JSON.stringify would have described a ReadableStream
    // as an empty object and a clean receipt would follow.
    if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
      return { kind: 'opaque_stream', mime: null, bytes: -1 };
    }
    // A Request owns its body as a stream that cannot be inspected without consuming it. The fetch
    // wrapper substitutes this marker so classification is complete BEFORE note() publishes the
    // record through the Playwright binding. Mutating the retained array afterwards is too late: a
    // binding argument is serialized at invocation and would preserve the earlier JSON verdict.
    if (body && body.__ss_opaque_request_body === true) {
      return { kind: 'opaque_stream', mime: null, bytes: -1 };
    }
    if (isNumericSampleArray(body)) {
      let bytes = -1;
      try { bytes = JSON.stringify(body).length; } catch (e) { void e; }
      return { kind: 'encoded_audio', mime: 'application/json', bytes };
    }
    if (typeof body === 'object') {
      let bytes = 0;
      try { bytes = JSON.stringify(body).length; } catch (e) { void e; bytes = -1; }
      const inspected = inspectEncodedAudio(body, 0, { remaining: 128 }, false);
      const candidateChars = countShortEncodedAudioCandidates(body, 0, { remaining: 128 }, false);
      return {
        kind: inspected === 'audio' || candidateChars >= 256
          ? 'encoded_audio' : inspected === 'opaque' ? 'blob' : 'json',
        mime: 'application/json',
        bytes,
        candidateChars,
      };
    }
    return { kind: 'unknown', mime: null, bytes: -1 };
  };

  // Audio streaming commonly divides one logical base64 payload across transport frames. Keep only a
  // bounded numeric count per transport/origin — never the frame contents or URL path/query — so repeated
  // short chunks cannot each receive a clean verdict. Per-part query strings must not split one logical
  // upload into unrelated sequences. A gap or ordinary message starts a fresh sequence.
  const shortEncodedSequences = new Map();
  const shortEncodedSequenceKey = (transport, method, url) => {
    let origin = '<unparseable>';
    try {
      const base = w.location && w.location.href ? w.location.href : undefined;
      origin = new URL(String(url || ''), base).origin;
    } catch (e) { void e; }
    return String(transport) + '\\n' + String(method || 'GET').toUpperCase() + '\\n' + origin;
  };
  const note = (transport, url, method, body, extraMime) => {
    try {
      const c = classify(body);
      const now = Date.now();
      const sequenceKey = shortEncodedSequenceKey(transport, method, url);
      const candidateChars = Number(c.candidateChars || 0);
      if (candidateChars > 0 && c.kind !== 'encoded_audio' && c.kind !== 'audio') {
        const prior = shortEncodedSequences.get(sequenceKey);
        const chars = prior && now - prior.at <= 5_000 ? prior.chars + candidateChars : candidateChars;
        shortEncodedSequences.set(sequenceKey, { chars: Math.min(chars, 256), at: now });
        if (chars >= 256) c.kind = 'encoded_audio';
      } else if (candidateChars === 0 && shortEncodedSequences.has(sequenceKey)
        && now - shortEncodedSequences.get(sequenceKey).at > 5_000) {
        // An unrelated control frame does not disprove the bounded audio sequence. Only elapsed time
        // retires it; otherwise keepalives could be interleaved between every chunk to reset the proof.
        shortEncodedSequences.delete(sequenceKey);
      }
      const record = {
        // WHEN, so "during the take" can be decided per record rather than for the whole run. Without
        // it a single end-of-run flag applied retroactively to startup traffic.
        t: now,
        transport,
        url: String(url || ''),
        method: String(method || 'GET').toUpperCase(),
        kind: c.kind,
        mime: extraMime || c.mime,
        bytes: c.bytes,
        ctor: c.ctor || null,
        // Absent in a worker; the main-document record carries the phase and findings are correlated
        // by time, so a worker record reports null rather than failing to record at all.
        runtimeState: (typeof document !== 'undefined' && document.documentElement)
          ? document.documentElement.getAttribute('data-runtime-state') : null,
      };
      records.push(record);
      // The observer receives metadata only — never payload contents — and redacts the URL before
      // retaining it. Workers relay while alive because a successful Stop terminates them before the
      // post-save verdict; the document forwards those records through the Playwright binding.
      if (hasDocument && typeof w.__SS_TRIPWIRE_EMIT__ === 'function') {
        try { void emitRecord({ ...record, __ssSource: 'main' }); } catch (e) { void e; }
      } else if (isWorker && relay) {
        try {
          if (!relayCounter) {
            relay.postMessage({ marker: relayMarker, type: 'relay_failure', workerId });
            return;
          }
          const sequence = Atomics.add(relayCounter, 0, 1) + 1;
          relay.postMessage({ marker: relayMarker, type: 'record', workerId, sequence, record });
        } catch (e) { void e; }
      }
    } catch (e) { void e; }
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
          ? (init.headers['Content-Type'] || init.headers['content-type'] || null) : null;

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
          note('fetch', url, method, body, mime);
        } else {
          note('fetch', url, method, body, mime);
        }
      } catch (e) { void e; }
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

  // Native form submission bypasses fetch/XHR/beacon entirely. Snapshot only its FormData shape before
  // navigation (field names, MIME, and byte counts); note() never retains field values.
  const NativeForm = w.HTMLFormElement;
  if (hasDocument && NativeForm && NativeForm.prototype && typeof FormData === 'function') {
    const observeForm = (form, submitter) => {
      try {
        let body;
        try { body = submitter === undefined ? new FormData(form) : new FormData(form, submitter); }
        catch (e) { void e; body = new FormData(form); }
        const url = (submitter && submitter.formAction) || form.action || (document && document.location);
        const method = (submitter && submitter.formMethod) || form.method || 'GET';
        const mime = (submitter && submitter.formEnctype) || form.enctype || null;
        note('form', url, method, body, mime);
      } catch (e) { void e; }
    };
    // Browser-initiated submits (button click, Enter, button.click()) do not call the form methods
    // above. Capture the native submit event before navigation. requestSubmit() is covered here too;
    // observing it in both places would duplicate the same payload record.
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('submit', (event) => {
        const form = event && event.target;
        if (!(form instanceof NativeForm)) return;
        observeForm(form, event.submitter);
      }, true);
    }
    // submit() deliberately emits no submit event, so it still needs a direct wrapper.
    if (typeof NativeForm.prototype.submit === 'function') {
      const submit = NativeForm.prototype.submit;
      NativeForm.prototype.submit = function () {
        observeForm(this);
        return submit.apply(this, arguments);
      };
    }
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

  // Playwright exposes WebSocket creation natively, but has no EventSource event. Wrap the constructor
  // before app code and emit URL metadata immediately, so an approved GET cannot hide a long-lived
  // channel from the separate channel policy. The receiver redacts before retaining it.
  const ES = w.EventSource;
  if (ES) {
    const Wrapped = function (url, config) {
      try {
        const record = { kind: 'eventsource', url: String(url || '') };
        if (hasDocument) {
          void emitChannelRecord(record);
        } else if (isWorker && relay) {
          if (!relayCounter) {
            relay.postMessage({ marker: relayMarker, type: 'relay_failure', workerId });
          } else {
            const sequence = Atomics.add(relayCounter, 0, 1) + 1;
            relay.postMessage({ marker: relayMarker, type: 'channel', workerId, sequence, record });
          }
        }
      } catch (e) { void e; }
      return config === undefined ? new ES(url) : new ES(url, config);
    };
    Wrapped.prototype = ES.prototype;
    ['CONNECTING', 'OPEN', 'CLOSED'].forEach((k) => { Wrapped[k] = ES[k]; });
    w.EventSource = Wrapped;
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
