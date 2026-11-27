// Structural qualification only; caller must independently authenticate provenance and observations.
const sha = /^[a-f0-9]{40}$/;
const devices = ['desktop', 'iphone-safari', 'android-chrome'];
const object = (x, keys) => x !== null && typeof x === 'object' && !Array.isArray(x)
  && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const metric = x => Number.isSafeInteger(x) && x >= 0;
const timing = x => object(x, ['bytes','transferMs','setupMs'])
  && [x.bytes,x.transferMs,x.setupMs].every(metric) && x.bytes > 0 && x.transferMs > 0 && x.setupMs >= x.transferMs;
const checks = ['allow', 'deny', 'workerStarted', 'noDownloadBeforeConsent', 'coldDownloadVerified',
  'betweenFilesRetrySaved', 'midFileRetrySaved', 'cancelSafe', 'cacheEvictionTruthful',
  'warmNoSetupPrompt', 'warmSaved', 'lockRecovered', 'backgroundRecovered'];
const fields = ['target','physical','wifi','mobileThrottled','warmBytes','warmReadyMs','takes', ...checks];

export function privateSttDevicePreflight(receipt, expectedSha) {
  const hold = reason => ({ status: 'HOLD', reason });
  if (typeof expectedSha !== 'string' || !sha.test(expectedSha)
      || !object(receipt, ['sourceSha','servedSha','devices'])
      || receipt.sourceSha !== expectedSha || receipt.servedSha !== expectedSha)
    return hold('release_binding');
  if (!Array.isArray(receipt.devices) || receipt.devices.length !== devices.length) return hold('device_matrix');
  const seen = new Set();
  for (const d of receipt.devices) {
    if (!object(d, fields) || !devices.includes(d.target) || seen.has(d.target)
        || (d.target === 'desktop' ? typeof d.physical !== 'boolean' : d.physical !== true))
      return hold('device_matrix');
    seen.add(d.target);
    if (!checks.every(k => d[k] === true)) return hold('device_behavior');
    if (!timing(d.wifi) || !timing(d.mobileThrottled)) return hold('cold_transfer');
    if (!object(d.warmBytes,['session2','session3']) || d.warmBytes.session2 !== 0 || d.warmBytes.session3 !== 0)
      return hold('warm_cache');
    if (!object(d.warmReadyMs, ['session2', 'session3'])
        || ![d.warmReadyMs.session2, d.warmReadyMs.session3].every(ms => metric(ms) && ms <= 5000))
      return hold('warm_cache_ready_latency');
    if (!Array.isArray(d.takes) || d.takes.length < 20 || d.takes.length > 200) return hold('warm_sample');
    const ordinals = new Set();
    let timely = 0;
    for (const t of d.takes) {
      if (!object(t,['ordinal','durationMs','finalMs','stopAckMs','reload','saveCount','ownedSaveMatchesTake'])
          || !Number.isSafeInteger(t.ordinal) || t.ordinal < 1 || t.ordinal > d.takes.length || ordinals.has(t.ordinal)
          || !metric(t.durationMs) || t.durationMs < 29000 || t.durationMs > 31000 || !metric(t.finalMs) || !metric(t.stopAckMs))
        return hold('warm_sample');
      ordinals.add(t.ordinal);
      if (t.reload !== false || t.saveCount !== 1 || t.ownedSaveMatchesTake !== true || t.stopAckMs > 250) return hold('warm_integrity');
      if (t.finalMs <= 5000) timely++;
    }
    if (timely * 100 < 95 * d.takes.length) return hold('warm_final_latency');
  }
  return { status: 'STRUCTURALLY_COMPLETE', reason: 'device_receipt_shape_only' };
}
