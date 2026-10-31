'use strict';
// Installed-receipt browser mode: the ONE definition of what an installed-browser receipt must prove and of the identity it gives the
// admitted runtime. browser-setup.cjs, runtime-admission.cjs and qualification/selftest.cjs all use it, so the identity cannot drift.
// The receipt is written by scripts/install_browser.py --installed; the minimum major is the REVIEWED baseline admission passes in, never the
// receipt's own claim. Nothing here downloads, substitutes or invents a Playwright revision.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = 'speaksharp.cloud-test.installed-browser.v1';
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const VERSION_LINE = /^(Google Chrome|Chromium)(?: for Testing)? (\d+)\.(\d+)\.(\d+)\.(\d+)\b/;

function head(file) { const fd = fs.openSync(file, 'r'), b = Buffer.alloc(4); try { fs.readSync(fd, b, 0, 4, 0); } finally { fs.closeSync(fd); } return b; }
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const DEFAULT_IO = { lstat: fs.lstatSync, realpath: fs.realpathSync, head, sha };

function refuse(reason) { const e = new Error(reason); e.code = 'INSTALLED_BROWSER_REFUSED'; throw e; }

/** The canonical native binary the receipt binds, or a refusal naming the first unmet condition. */
function validateInstalledReceipt(receipt, minimumMajor, io = DEFAULT_IO) {
  if (!Number.isSafeInteger(minimumMajor) || minimumMajor < 1) refuse('reviewed browser baseline missing');
  if (receipt?.schema !== SCHEMA || receipt.binaryFormat !== 'ELF' || receipt.versionExecuted !== true) refuse('receipt is not a version-executed native Linux installed-browser receipt');
  if (receipt.minimumMajor !== minimumMajor) refuse('receipt was made against a different browser baseline');
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(receipt.version || '') || Number(receipt.version.split('.')[0]) < minimumMajor) refuse('receipt version is missing or below the reviewed baseline');
  if (typeof receipt.path !== 'string' || !path.isAbsolute(receipt.path)) refuse('receipt browser path must be absolute');
  let st;
  try { st = io.lstat(receipt.path); } catch { refuse('receipt browser is not present'); }
  if (st.isSymbolicLink() || !st.isFile() || io.realpath(receipt.path) !== receipt.path) refuse('receipt browser must be a canonical regular file');
  if (!io.head(receipt.path).equals(ELF)) refuse('receipt browser is not a native ELF binary');
  if (!/^[a-f0-9]{64}$/.test(receipt.observedBinarySha256 || '') || io.sha(receipt.path) !== receipt.observedBinarySha256) refuse('receipt browser bytes differ from the receipt');
  return receipt.path;
}

/** The wrapped copy must report exactly the receipt's version, at or above the reviewed baseline. */
function wrappedVersionMatches(output, receipt, minimumMajor) {
  const m = VERSION_LINE.exec(String(output || '').trim());
  return !!m && [2, 3, 4, 5].map(i => m[i]).join('.') === receipt.version && Number(m[2]) >= minimumMajor;
}

/** The admitted browser identity from browser.json: Playwright's revision, or the receipt in installed mode; null when malformed. */
function browserIdentity(b) {
  if (b?.browserMode === undefined) return typeof b?.revision === 'string' && /^chromium-\d+$/.test(b.revision) ? b.revision : null;
  if (b.browserMode !== 'installed-receipt' || b.revision !== null || !/^[a-f0-9]{64}$/.test(b.receiptSha256 || '') || !/^\d+\.\d+\.\d+\.\d+$/.test(b.installedVersion || '')) return null;
  return 'installed:' + b.receiptSha256;
}

module.exports = { SCHEMA, VERSION_LINE, validateInstalledReceipt, wrappedVersionMatches, browserIdentity };
