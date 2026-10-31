#!/usr/bin/env node
'use strict';
// browser-setup.cjs --playwright <version> (--revision <chromium-NNNN> | --browser-receipt <installed-browser.json>) [--out <browser.json>]
// Browser discovery for the guarded lane. Resolves the Chromium that the installed Playwright
// expects, refuses a version/revision mismatch (no symlink or alternate browser), copies it to the
// 65534-traversable root /var/tmp/ss-harness/chrome-linux, installs chrome-wrapper.sh, and writes
// browser.json for Playwright (executablePath) and Lighthouse (CHROME_PATH). Exit 0 only when the
// copy and wrapper are byte-checked and `--version` runs through the wrapper as 65534.
// Installed-receipt mode binds instead the preinstalled native browser recorded by
// scripts/install_browser.py --installed: same path, same bytes, same version, at or above the receipt's
// baseline. It never downloads or substitutes, and records no Playwright revision it does not have.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const { assertSecurityApproval } = require('./approval-gate.cjs');
const {childEnvironment,strictPairs}=require('./launch-boundary.cjs');
const ROOT = '/var/tmp/ss-harness';
let args;try{args=strictPairs(process.argv.slice(2),['playwright','revision','browser-receipt','minimum-major','out','security-approval'],['playwright','security-approval']);}catch(e){console.error('browser-setup: '+e.message);process.exit(2);}
function fail(msg) { console.error('browser-setup: BLOCKED_SETUP: ' + msg); process.exit(2); }
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

try { assertSecurityApproval({ securityApprovalFile: args['security-approval'] }, { hosts: {} }); } catch (e) { fail(e.message); }

const installed = 'browser-receipt' in args;
if (!args.playwright || installed === ('revision' in args) || installed !== ('minimum-major' in args) || (!installed && !/^chromium-\d+$/.test(args.revision || '')) || (installed && !/^[1-9][0-9]{0,3}$/.test(args['minimum-major']))) fail('usage: --playwright <version> (--revision chromium-NNNN | --browser-receipt <file> --minimum-major <reviewed baseline>)');
let pwPkg, chromium;
try { pwPkg = require(require.resolve('playwright/package.json', { paths: [process.cwd()] })); chromium = require(require.resolve('playwright', { paths: [process.cwd()] })).chromium; }
catch (e) { fail('playwright is not resolvable from ' + process.cwd()); }
if (pwPkg.version !== args.playwright) fail(`playwright ${pwPkg.version} installed, ${args.playwright} required`);
const installedBrowser = require('./installed-browser.cjs');
let exe, receipt = null;
if (installed) {
  try { receipt = JSON.parse(fs.readFileSync(args['browser-receipt'], 'utf8')); } catch { fail('installed-browser receipt is unreadable'); }
  try { exe = installedBrowser.validateInstalledReceipt(receipt, Number(args['minimum-major'])); } catch (e) { fail(e.message); }
} else {
  exe = chromium.executablePath();
  if (!exe.split(path.sep).includes(args.revision)) fail(`Playwright expects ${exe}, not revision ${args.revision}`);
  if (!fs.existsSync(exe)) fail('expected Chromium is not installed: ' + exe);
}
const srcDir = path.dirname(exe);

fs.mkdirSync(ROOT, { recursive: true, mode: 0o755 });
fs.chmodSync(ROOT, 0o755);
for (const d of ['profiles', 'home', 'downloads']) {
  const p = path.join(ROOT, d);
  fs.mkdirSync(p, { recursive: true });
  fs.chownSync(p, 65534, 65534);
  fs.chmodSync(p, 0o700);
}
const dst = path.join(ROOT, 'chrome-linux');
fs.rmSync(dst, { recursive: true, force: true });
execFileSync('cp', ['-a', '--no-preserve=ownership', srcDir + '/.', dst + '/'], { stdio: 'inherit' });
execFileSync('chown', ['-R', '0:0', dst]);
execFileSync('chmod', ['-R', 'a+rX,go-w', dst]);
if (sha(path.join(dst, 'chrome')) !== sha(exe)) fail('copied chrome binary differs from the source');

const wrapperSrc = path.join(__dirname, 'chrome-wrapper.sh');
const wrapper = path.join(ROOT, 'chrome-wrapper.sh');
fs.copyFileSync(wrapperSrc, wrapper);
fs.chownSync(wrapper, 0, 0);
fs.chmodSync(wrapper, 0o755);
if (sha(wrapper) !== sha(wrapperSrc)) fail('installed wrapper differs from the bundle copy');

let version;
try { version = execFileSync(wrapper, ['--version'], { encoding: 'utf8', timeout: 20000, env:childEnvironment({node:process.execPath,bundleRoot:path.resolve(__dirname,'..'),approvalFile:path.resolve(args['security-approval']),mode:'version-probe'}) }).trim(); }
catch (e) { fail('chrome --version through the wrapper failed: ' + (e.stderr || e.message)); }
if (installed) {
  if (!installedBrowser.wrappedVersionMatches(version, receipt, Number(args['minimum-major']))) fail('the wrapped copy reports a version other than the receipt, or below the reviewed baseline');
}
const out = {
  playwrightVersion: pwPkg.version, revision: installed ? null : args.revision, chromeVersion: version,
  sourceExecutable: exe, chromeSha256: sha(exe), copiedExecutable: path.join(dst, 'chrome'),
  wrapperPath: wrapper, wrapperSha256: sha(wrapper), runAsUid: 65534,
  profilesRoot: path.join(ROOT, 'profiles'), downloadsPath: path.join(ROOT, 'downloads'),
  ...(installed ? { browserMode: 'installed-receipt', installedVersion: receipt.version, minimumMajor: Number(args['minimum-major']), receiptSha256: sha(args['browser-receipt']) } : {}),
};
const outPath = args.out || path.join(ROOT, 'browser.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
