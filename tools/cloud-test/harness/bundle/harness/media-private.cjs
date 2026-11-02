'use strict';
// Rev3 private media: current-UID copies, or explicitly bound root -> 65534 provisioning.
// Cross-UID source is implemented but must be qualified in R0; no chmod/chown of existing
// parents, no trust changes, no shared-readable audio, and no deletion of source media.
const nodeFs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createPrivateMedia(input, adapter = {}) {
  // Adapter is only for deterministic offline unit tests, not untrusted step execution.
  const fs = adapter.fs || nodeFs;
  const uid = adapter.getuid ? adapter.getuid() : (process.getuid ? process.getuid() : null);
  const gid = adapter.getgid ? adapter.getgid() : (process.getgid ? process.getgid() : null);
  const { sourceFile, expectedSha256 } = input;
  const targetUid = input.targetUid === undefined ? uid : input.targetUid;
  const targetGid = input.targetGid === undefined ? gid : input.targetGid;
  const crossUid = targetUid !== uid || targetGid !== gid;
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid)) throw new Error('private media requires POSIX ownership proof');
  if (!Number.isSafeInteger(targetUid) || !Number.isSafeInteger(targetGid) || targetUid < 0 || targetGid < 0) throw new Error('explicit valid target UID/GID required');
  if (!/^[0-9a-f]{64}$/.test(expectedSha256 || '')) throw new Error('reviewed media SHA256 required');
  let parent;
  if (crossUid) {
    if (uid !== 0) throw new Error('HARNESS_LIMITED: cross-UID private media provisioning requires the reviewed root supervisor');
    if (input.targetUid !== 65534 || input.targetGid !== 65534) throw new Error('cross-UID target must explicitly bind reviewed UID/GID 65534');
    parent = input.approvedPrivateParent;
    if (typeof parent !== 'string' || !path.isAbsolute(parent) || path.resolve(parent) !== parent) throw new Error('already-existing approvedPrivateParent must be explicitly bound');
    const st = fs.lstatSync(parent);
    if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== 0 || (st.mode & 0o022) !== 0 || fs.realpathSync(parent) !== parent) throw new Error('approved private parent must be existing root-owned, non-symlink and not group/other writable');
    if (!(st.mode & 0o001) && !(st.gid === targetGid && (st.mode & 0o010))) throw new Error('approved private parent is not already traversable by target UID/GID');
  } else {
    parent = path.resolve(input.runDir);
    const st = fs.lstatSync(parent);
    if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== uid || (st.mode & 0o077) !== 0 || fs.realpathSync(parent) !== parent) throw new Error('private directory required (owned non-symlink mode 0700)');
  }
  const source = fs.lstatSync(sourceFile);
  if (source.isSymbolicLink() || !source.isFile() || source.nlink !== 1) throw new Error('media source must be a regular non-symlink, single-link file');
  // O_NOFOLLOW binds reads to a regular file, preventing a replacement symlink race.
  const sourceFd = fs.openSync(sourceFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let buf;
  try {
    const opened = fs.fstatSync(sourceFd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== source.dev || opened.ino !== source.ino) throw new Error('media source identity changed while opening');
    buf = fs.readFileSync(sourceFd);
  } finally { fs.closeSync(sourceFd); }
  if (buf.length < 44 || buf.subarray(0, 4).toString() !== 'RIFF' || buf.subarray(8, 12).toString() !== 'WAVE') throw new Error('media.file is not a WAV file');
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha256 !== expectedSha256) throw new Error('media content hash differs from reviewed fixture');
  const dir = fs.mkdtempSync(path.join(parent, 'media-private-'));
  const createdDir = fs.lstatSync(dir);
  const dst = path.join(dir, 'capture.wav');
  let createdFile = null; let dirTransferred = false;
  function sameNode(st, original, kind, ownerUid, ownerGid, mode) {
    return !st.isSymbolicLink() && (kind === 'directory' ? st.isDirectory() : st.isFile() && st.nlink === 1) &&
      st.dev === original.dev && st.ino === original.ino && st.uid === ownerUid && st.gid === ownerGid && (st.mode & 0o777) === mode;
  }
  try {
    if (!sameNode(createdDir, createdDir, 'directory', uid, gid, 0o700)) throw new Error('fresh private media directory not created as owned 0700');
    const fd = fs.openSync(dst, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, buf); fs.fsyncSync(fd); createdFile = fs.fstatSync(fd); } finally { fs.closeSync(fd); }
    if (!sameNode(createdFile, createdFile, 'file', uid, gid, 0o600)) throw new Error('fresh private media file not created as owned 0600');
    if (crossUid) {
      // Ownership transfer is confined to these two fresh nodes. Parent/source are never modified.
      // Directory remains root-only until after file ownership is transferred.
      fs.chownSync(dst, targetUid, targetGid);
      fs.chownSync(dir, targetUid, targetGid); dirTransferred = true;
    }
    if (!sameNode(fs.lstatSync(dir), createdDir, 'directory', targetUid, targetGid, 0o700) ||
        !sameNode(fs.lstatSync(dst), createdFile, 'file', targetUid, targetGid, 0o600)) throw new Error('private media ownership verification failed');
    const verifyFd = fs.openSync(dst, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      if (!sameNode(fs.fstatSync(verifyFd), createdFile, 'file', targetUid, targetGid, 0o600)) throw new Error('private media file changed while verifying');
      if (crypto.createHash('sha256').update(fs.readFileSync(verifyFd)).digest('hex') !== sha256) throw new Error('private media bytes changed after provisioning');
    } finally { fs.closeSync(verifyFd); }
    let cleaned = false;
    return { sha256, path: dst, directory: dir, targetUid, targetGid, crossUid,
      flags: ['--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + dst],
      cleanup() {
        if (cleaned) return;
        if (path.dirname(dir) !== parent || !path.basename(dir).startsWith('media-private-')) throw new Error('media cleanup scope mismatch');
        if (!sameNode(fs.lstatSync(dir), createdDir, 'directory', targetUid, targetGid, 0o700)) throw new Error('media directory identity/ownership changed; manual scoped cleanup required');
        for (const name of fs.readdirSync(dir)) if (name !== 'capture.wav') throw new Error('unexpected media-directory content; manual scoped cleanup required');
        if (!sameNode(fs.lstatSync(dst), createdFile, 'file', targetUid, targetGid, 0o600)) throw new Error('media file identity/ownership changed; manual scoped cleanup required');
        fs.unlinkSync(dst); fs.rmdirSync(dir); cleaned = true;
      } };
  } catch (e) {
    // Never recursively remove after target ownership becomes effective. Conserve unexpected
    // replacements/content for explicit review rather than deleting a guessed path.
    try {
      const ownerUid = dirTransferred ? targetUid : uid; const ownerGid = dirTransferred ? targetGid : gid;
      if (sameNode(fs.lstatSync(dir), createdDir, 'directory', ownerUid, ownerGid, 0o700)) {
        const names = fs.readdirSync(dir);
        if (names.length === 0) fs.rmdirSync(dir);
        else if (names.length === 1 && names[0] === 'capture.wav' && createdFile) {
          const f = fs.lstatSync(dst);
          if (!f.isSymbolicLink() && f.isFile() && f.dev === createdFile.dev && f.ino === createdFile.ino && f.nlink === 1) { fs.unlinkSync(dst); fs.rmdirSync(dir); }
        }
      }
    } catch { /* Original error remains; run report must record manual cleanup if path survives. */ }
    throw e;
  }
}
function preparePrivateMedia({ file, runDir, expectedSha256, browserUid, browserGid, approvedPrivateParent }, adapter) {
  return createPrivateMedia({ sourceFile: file, runDir, expectedSha256, targetUid: browserUid, targetGid: browserGid, approvedPrivateParent }, adapter);
}
module.exports = { preparePrivateMedia, createPrivateMedia };
