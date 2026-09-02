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

  const classify = (body) => {
    if (body === null || body === undefined) return { kind: 'empty', mime: null, bytes: 0 };
    if (typeof body === 'string') return { kind: 'text', mime: null, bytes: body.length };
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
      const mime = body.type || '';
      // A MediaRecorder chunk is a Blob whose type is audio/* or video/* — the direct evidence that
      // captured audio is being handed to a transport.
      const kind = /^(audio|video)\\//.test(mime) ? 'audio' : (mime ? 'blob' : 'binary');
      return { kind, mime: mime || null, bytes: body.size };
    }
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      let audio = false; let bytes = 0;
      try {
        for (const [, v] of body.entries()) {
          if (typeof Blob !== 'undefined' && v instanceof Blob) {
            bytes += v.size;
            if (/^(audio|video)\\//.test(v.type || '')) audio = true;
          }
        }
      } catch (e) { void e; }
      return { kind: audio ? 'audio' : 'form', mime: 'multipart/form-data', bytes };
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
    if (typeof body === 'object') {
      let bytes = 0;
      try { bytes = JSON.stringify(body).length; } catch (e) { void e; bytes = -1; }
      return { kind: 'json', mime: 'application/json', bytes };
    }
    return { kind: 'unknown', mime: null, bytes: -1 };
  };

  const note = (transport, url, method, body, extraMime) => {
    try {
      const c = classify(body);
      records.push({
        // WHEN, so "during the take" can be decided per record rather than for the whole run. Without
        // it a single end-of-run flag applied retroactively to startup traffic.
        t: Date.now(),
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
      });
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
          note('fetch', url, method, undefined, mime);
          records[records.length - 1].kind = 'opaque_stream';
          records[records.length - 1].bytes = -1;
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
