import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

// Documentation-integrity guard for the ACTIVE product_release SSOT (root *.md only — the archive/
// evidence subtrees are historical and intentionally not policed). It fails when the active docs
// drift from the merged product truth. It deliberately does NOT hard-code the current main SHA
// (a docs-only merge changes it), so it stays green across future docs merges.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PR_DIR = resolve(ROOT, 'product_release');

const activeDocs = readdirSync(PR_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => join(PR_DIR, f)); // root-level only; excludes archive/, evidence/, v4_work/

const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => p.slice(ROOT.length + 1);

// ---- Personal / local-machine path guard (docs/ + product_release/, ARCHIVES INCLUDED) ----------
// Archived pinned copies must not carry a contributor's absolute machine path (a privacy + portability
// leak). Unlike the active-SSOT guards above, this one recurses the whole tree, archives and all.
const MD_ROOTS = ['docs', 'product_release'].map((d) => resolve(ROOT, d)).filter((d) => existsSync(d));
function collectMarkdown(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) collectMarkdown(p, acc);
    else if (entry.isFile() && entry.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}
// Rejects file-URI and bare absolute paths under Users/home/root home directories, plus Windows
// user-profile paths under a drive letter. Portable examples (/tmp, $(pwd), ~/…, and commit-pinned
// GitHub URLs) are allowed. (The patterns live only in the regex below — not spelled out literally in
// prose here — so this guard file does not itself trip the repo-wide personal-path scan.)
const PERSONAL_PATH = /file:\/\/\/(Users|home|root)\/|\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\/;
// A line "current-asserts" a term unless it also carries a negation/removal marker.
const NEG = /\b(no|not|never|without|deleted|removed|no longer|superseded|gone|neither|zero|isn't|is not|does not|do not)\b/i;

// A line that asserts Cloud is unavailable in the beta.
const CLOUD_CLAIM = /cloud\b[^.]*\b(unavailable|not available|not part of the (invited|no-billing)? ?beta|no cloud for)/i;
// The claim is acceptable ONLY when it is EITHER explicitly limited to Free testers/users, OR it
// explicitly says existing/already-entitled paid-Pro accounts retain/keep access. Merely mentioning
// "paid-Pro" (e.g. "paid-Pro only") does NOT satisfy the exception.
const cloudExceptionOk = (line) => {
  const freeLimited = /\bfree (testers?|users?|accounts?)\b/i.test(line);
  const retainClause = /\b(existing|already)\b[^.]*\b(retain|keep)s?\b/i.test(line)
    || (/\b(retain|keep)s? access\b/i.test(line) && /\b(existing|paid[- ]?pro)\b/i.test(line));
  return freeLimited || retainClause;
};

// A line explicitly negating the "closure via key absence/class" model — either the negation precedes
// the key/absence concept ("does NOT depend on the key being absent"), or it follows a key-class
// subject ("key class alone does NOT open checkout").
const negatesBadModel = (line) =>
  /\b(not|no|regardless of|independent of|does not|doesn't)\b[^.]*\b(absent|absence|missing|present|presence|depend|key[- ]?class)\b/i.test(line)
  || /\bkey[- ]?class\b[^.]*\b(alone\b[^.]*)?(does not|do not|doesn't|is not|isn't|never|not\b)/i.test(line);

// ---- Block/paragraph-normalized billing + v4 posture guard --------------------------------------
// The earlier guard scanned one physical line at a time, so a stale claim spread across wrapped lines
// (or phrased as "the kill switch IS the key class" with no closure word on that line) escaped. This
// version normalizes each doc into scan UNITS: a paragraph is collapsed to a single line (catching
// claims split across wrapped lines), while each Markdown table row stays its own unit (so a legit
// row can't mask a stale sibling row in the same table).
const scanUnits = (text) => {
  const out = [];
  for (const para of text.split(/\n\s*\n/)) {
    if (/^\s*\|/m.test(para)) {
      for (const row of para.split('\n')) { const r = row.replace(/\s+/g, ' ').trim(); if (r) out.push(r); }
    } else {
      const p = para.replace(/\s+/g, ' ').trim(); if (p) out.push(p);
    }
  }
  return out;
};

// A unit is legitimized (never flagged) when it names the ACTUAL closure control — the two payment
// switches — or explicitly negates the key-class/key-swap model (a negation TIED to the key concept,
// not any stray "no"/"not" in the sentence). Key-class VALIDATION and webhook / entitlement
// requirements are legitimate and must survive; only "key class opens/closes checkout" is stale.
const SWITCH_CTX = /VITE_PAYMENTS_ENABLED|(^|[^A-Z_])PAYMENTS_ENABLED\b|\bboth (payment )?switches\b|\bpayment switch(es)?\b|\beither (payment )?switch\b/i;
const negatesKeyModel = (u) =>
  /\bkey[- ]?(class|swap)\b[^.]{0,40}\b(alone\b[^.]{0,20})?(does not|do not|doesn't|is not|isn't|are not|never|not\b)/i.test(u)
  || /\b(not|does not|doesn't|independent of|regardless of|by itself|alone)\b[^.]{0,40}\b(opens?|closes?|gate|the gate|key[- ]?class|key[- ]?swap)\b/i.test(u)
  || /\bnot\b[^.]{0,20}\bby (the )?key[- ]?class\b/i.test(u)
  || /only validates|validates (the )?configuration but|not (merely|just|solely) a key/i.test(u);

const KEYCLASS = /\bkey[- ]?class\b|classifyStripeKey|arePaymentsEnabledFor|stripeKeyClass|\bpublishable[- ]?key class\b/i;
const KEYSTATE = /\b(test|missing|unknown|absent)\b[^.]{0,40}\bkeys?\b|\bkeys?\b[^.]{0,40}\b(test|missing|unknown|absent)\b/i;
// The classifyStripeKey enum used as bare values ("test/missing/unknown", "live/test/missing") — a
// key-class-value signal even when the literal word "key" is absent on the line.
const KEYENUM = /\b(live|test|missing|unknown)\b[^A-Za-z0-9]+\b(test|missing|unknown|live)\b[^A-Za-z0-9]+\b(missing|unknown|live)\b|\b(test|missing|unknown)\b[^A-Za-z0-9]+\b(missing|unknown)\b/i;
const KEYSWAP = /\bkey[- ]?swap\b|\bconfig cutover\b|swap to [^.]*\b(sk_live|pk_live|live keys?)\b/i;
const KEYSWAP_CTX = /\b(launch|go[- ]?live|going live|live|paid|checkout|enrollment|cutover|ops)\b/i;
// NOTE: bare "fail-closed" is intentionally NOT a closure signal — config/webhook/canary fail-closed
// is legitimate (the instruction says to preserve it). Closure is signaled by "kill switch" or by
// checkout/payments explicitly closed/hidden/disabled.
const CLOSURE_GATE = /\bkill switch\b|\b(hide|hides|disable|disables|hidden|disabled|closed|not open)\b[^.]{0,40}\b((paid )?checkout|payments?|public checkout surfaces?)\b|\b((paid )?checkout|payments?)\b[^.]{0,40}\b(hidden|disabled|closed|not open)\b/i;
const OPEN_PAID = /\b(open (paid )?checkout|opens? checkout|enables? (paid )?(checkout|payments?)|payments? enabled|paid (launch|enrollment|checkout)|go[- ]?live|going live|unlock pro)\b/i;

// True when a scan unit asserts a stale billing/v4 model. Used by both the real-doc scan and the
// FAIL/PASS fixture tests below.
const staleBillingOrV4 = (unit) => {
  const keySide = KEYCLASS.test(unit) || KEYSTATE.test(unit) || KEYENUM.test(unit) || KEYSWAP.test(unit);
  const legit = SWITCH_CTX.test(unit) || negatesKeyModel(unit);
  const badClosureByKey = keySide && CLOSURE_GATE.test(unit) && !legit;                 // key class/state closes checkout
  const badOpenByKey = keySide && OPEN_PAID.test(unit) && !legit;                        // key swap/class alone opens paid
  const badKeySwap = KEYSWAP.test(unit) && KEYSWAP_CTX.test(unit) && !legit;             // "live key swap" as the go-live mechanism

  const v4 = /\bv4\b/i.test(unit);
  const v4NotOff = v4 && /\bv4\b[^.]{0,40}\bnot\s+["']?off\b/i.test(unit);
  const v4Active = v4
    && /\bv4\b[^.]{0,60}\b(is|remains|currently|stays|now|turned|switched)\b[^.]{0,40}\b(active|enabled|promoted|on|live)\b/i.test(unit)
    // future/phased/conditional rollout language is legitimate and must not read as "currently active".
    && !/\b(off|disabled|0%|future|separately authorized|held|gated|hard-?kill|promotion|phase|rollout|allowlist|deliberate|permanent|stays? primary|primary until|until the data|would|will|when|once|after|plan|not (currently )?(active|ready|enabled|promoted|on))\b/i.test(unit);

  return badClosureByKey || badOpenByKey || badKeySwap || v4NotOff || v4Active;
};

const scanDocForStale = (doc) =>
  scanUnits(read(doc)).filter(staleBillingOrV4).map((u) => `${rel(doc)}: ${u.slice(0, 160)}`);

// ---- Cross-document live-money-proof policy guard -----------------------------------------------
// One policy across active billing docs: the test-mode journey is the accepted functional proof; a
// real-money transaction is NOT a required Dev/CI/QA or launch proof; a controlled live smoke is
// optional, post-activation, separately-authorized ops diligence. This guard flags a unit that
// presents live-money / a real charge / cs_live / "flip live keys" as a REQUIRED proof, gate, or
// public-launch blocker — unless the unit marks it not-required / optional / accepted-in-test-mode.
const LIVEMONEY = /\b(live[- ]?money|real[- ]?money|real (payment|charge|checkout)|cs_live|live payment|money[- ]?proof|money[- ]?test|same proof with live (stripe )?keys|flip live keys)\b/i;
const REQUIRE_AS_PROOF = /\b(required|requires?|must|mandatory|no (paid )?go without|remain(s)? (a |the )?(public[- ]?launch )?blockers?|public-launch blockers?|only remaining item|the only remaining|is the (launch )?proof|as (the )?(launch |required )?proof)\b/i;
const okLiveMoneyPolicy = (u) =>
  /\b(not required|isn't required|is not required|no longer required|optional|ops diligence|diligence|post-?activation|after (separate|separately) authoriz|accepted (functional )?proof|not a (required )?(gate|proof|blocker|money-?proof)|no real-?money proof|never a (required )?proof)\b/i.test(u)
  || /\bno\b[^.]{0,60}\b(require|required)\b/i.test(u)
  || /\bnot\b[^.]{0,30}\b(require|required|a required)\b/i.test(u);
const staleLiveMoneyPolicy = (unit) =>
  LIVEMONEY.test(unit) && REQUIRE_AS_PROOF.test(unit) && !okLiveMoneyPolicy(unit);
const scanDocForLiveMoney = (doc) =>
  scanUnits(read(doc)).filter(staleLiveMoneyPolicy).map((u) => `${rel(doc)}: ${u.slice(0, 160)}`);

describe('product_release documentation integrity', () => {
  it('every relative Markdown link in active docs resolves to a real repo path', () => {
    const broken = [];
    const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
    for (const doc of activeDocs) {
      const text = read(doc);
      let m;
      while ((m = linkRe.exec(text)) !== null) {
        let target = m[1].trim();
        if (/^(https?:|mailto:|#)/i.test(target)) continue; // external / anchor
        target = target.split('#')[0].replace(/:\d+(-\d+)?$/, ''); // strip #anchor and :line
        if (!target) continue;
        const abs = resolve(dirname(doc), target);
        if (!existsSync(abs)) broken.push(`${rel(doc)} -> ${m[1]}`);
      }
    }
    expect(broken, `broken links:\n${broken.join('\n')}`).toEqual([]);
  });

  it('CODEBASE_MAP.md points at real code/test paths', () => {
    const map = resolve(PR_DIR, 'CODEBASE_MAP.md');
    expect(existsSync(map), 'CODEBASE_MAP.md must exist').toBe(true);
    const text = read(map);
    const broken = [];
    const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
    let m;
    while ((m = linkRe.exec(text)) !== null) {
      let t = m[1].trim();
      if (/^(https?:|mailto:|#)/i.test(t)) continue;
      t = t.split('#')[0].replace(/:\d+(-\d+)?$/, '');
      const abs = resolve(PR_DIR, t);
      if (!existsSync(abs)) broken.push(m[1]);
    }
    expect(broken, `CODEBASE_MAP broken paths:\n${broken.join('\n')}`).toEqual([]);
  });

  it('no active doc describes the completion toast / PostSaveToast / "Next: Analytics" overlay as current', () => {
    const offenders = [];
    const termRe = /(completion toast|PostSaveToast|Next:\s*Analytics)/i;
    for (const doc of activeDocs) {
      read(doc).split('\n').forEach((line, i) => {
        if (termRe.test(line) && !NEG.test(line)) offenders.push(`${rel(doc)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, `stale current-toast claims:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('SOFT_RELEASE_TESTER_INSTRUCTIONS.md has no [insert link] placeholder or 1–10 rating', () => {
    const p = resolve(PR_DIR, 'SOFT_RELEASE_TESTER_INSTRUCTIONS.md');
    const text = read(p);
    expect(text.includes('[insert link]'), 'contains [insert link] placeholder').toBe(false);
    expect(/\b1\s*[–-]\s*10\b/.test(text), 'contains a 1–10 rating request').toBe(false);
  });

  it('BACKLOG.md does not re-list the completed P0.2 / P1.1 headings', () => {
    const text = read(resolve(PR_DIR, 'BACKLOG.md'));
    expect(text.includes('P0.2 — Private-first mode hierarchy'), 'P0.2 completed heading present').toBe(false);
    expect(text.includes('P1.1 — Private-first UX polish'), 'P1.1 completed heading present').toBe(false);
  });

  it('no active doc asserts #1006 is shipped/deployed/activated (it is DRAFT)', () => {
    const offenders = [];
    for (const doc of activeDocs) {
      read(doc).split('\n').forEach((line, i) => {
        if (!/#1006/.test(line)) return;
        // "shipped/deployed/activated/live" asserted on the same line without a draft/negation qualifier.
        if (/\b(shipped|deployed|activated|is live|went live|in production)\b/i.test(line)
            && !/\b(draft|not|never|pending|unactivated|un-activated|before|once|after|when|would|will|until|would-be)\b/i.test(line)) {
          offenders.push(`${rel(doc)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, `#1006-shipped claims:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('SOFT_RELEASE_TESTER_INSTRUCTIONS.md is not branded with the historical v0.9.0-rc4 / first-batch labels', () => {
    const text = read(resolve(PR_DIR, 'SOFT_RELEASE_TESTER_INSTRUCTIONS.md'));
    const offenders = text.split('\n')
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /\brc4\b|v0\.9\.0-rc4|first(-| )controlled batch|controlled first batch/i.test(l))
      .map(({ l, i }) => `${i + 1}: ${l.trim()}`);
    expect(offenders, `rc4/first-batch branding in tester instructions:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no active doc asserts Cloud is unavailable without the Free / existing-paid-Pro distinction', () => {
    const offenders = [];
    for (const doc of activeDocs) {
      read(doc).split('\n').forEach((line, i) => {
        if (CLOUD_CLAIM.test(line) && !cloudExceptionOk(line)) offenders.push(`${rel(doc)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, `unconditional Cloud-unavailable claims:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('Cloud-exception classifier: paid-Pro-only is rejected; Free-limited + existing-retain is accepted', () => {
    const flags = (line) => CLOUD_CLAIM.test(line) && !cloudExceptionOk(line);
    // Must FAIL the guard (unconditional / paid-Pro-only is not enough):
    expect(flags('Cloud is unavailable during the beta; paid-Pro only')).toBe(true);
    expect(flags('Cloud is unavailable during the no-billing beta.')).toBe(true);
    // Must PASS the guard (Free-limited and/or existing paid-Pro retains access):
    expect(flags('Cloud is unavailable to Free testers; existing paid-Pro retains access')).toBe(false);
    expect(flags('Cloud is not available to Free users during the no-billing beta')).toBe(false);
  });

  it('no active doc references the deleted "BACKLOG re-assessment addendum"', () => {
    const offenders = [];
    for (const doc of activeDocs) {
      read(doc).split('\n').forEach((line, i) => {
        if (/re-?assessment addendum/i.test(line)) offenders.push(`${rel(doc)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, `stale addendum references:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no active doc claims billing fail-closed depends on the Stripe key being absent or key-class alone', () => {
    const offenders = [];
    // The stale/wrong model ties CLOSURE (fail-closed / checkout closed) to key ABSENCE or key CLASS.
    // Both a closure concept AND a key-absence/class concept must appear on the line (so plain key-class
    // *classification* like `classifyStripeKey(...)` or a launch key-class proof is not a false positive).
    const closure = /\b(fail[- ]?closed|closure|checkout (is|remains|stays)[^.]*closed|(billing|payments?)[^.]*closed)\b/i;
    const keyDependence = /\bkey (being |is )?(absent|missing)\b|\b(absent|missing)\b[^.]*\bkey\b|\bkey[- ]?class\b/i;
    for (const doc of activeDocs) {
      read(doc).split('\n').forEach((line, i) => {
        if (!/stripe|payment|checkout|billing/i.test(line)) return;
        if (closure.test(line) && keyDependence.test(line) && !negatesBadModel(line)) {
          offenders.push(`${rel(doc)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, `stale billing-loading-model (key-absent / key-class) claims:\n${offenders.join('\n')}`).toEqual([]);

    // ...and the canonical inventory must document BOTH payment switches (the real closure control).
    const env = read(resolve(PR_DIR, 'ENV_INVENTORY.md'));
    expect(env.includes('VITE_PAYMENTS_ENABLED'), 'ENV_INVENTORY must document VITE_PAYMENTS_ENABLED').toBe(true);
    expect(/(^|[^_A-Z])PAYMENTS_ENABLED\b/m.test(env), 'ENV_INVENTORY must document PAYMENTS_ENABLED').toBe(true);
  });

  it('no active doc contradicts the billing-switch / v4-OFF posture (block-normalized scan)', () => {
    const offenders = activeDocs.flatMap(scanDocForStale);
    expect(offenders, `posture-contradiction claims:\n${offenders.join('\n')}`).toEqual([]);
  });

  // The guard must actually reject the stale statements — proven with FAIL fixtures — while leaving
  // legitimate switch/validation statements alone (PASS fixtures). These are the block-level contract.
  it('billing/v4 guard REJECTS the canonical stale statements (FAIL fixtures)', () => {
    const mustFail = [
      // key-class model
      'The kill switch is the publishable-key class plus webhook-signature-verified entitlement.',
      'Payments are gated solely by the key class: a live key enables checkout while a test or missing key disables checkout.',
      'arePaymentsEnabledFor(key) = classifyStripeKey(key) === "live" is the complete payment gate; test/missing/unknown hide checkout.',
      'Checkout is closed because the Stripe key is missing or set to a test key.',
      'Release rule: a production deploy must run live; test/missing/unknown keys hide/disable all public checkout surfaces.',
      // key-swap-only paid launch
      'Going live is an Ops config cutover: a live key swap to sk_live/pk_live is all that is required.',
      'Paid launch is only a key swap.',
      // v4
      'Private v4 is currently active and enabled for testers.',
      "Private v4 is not 'off' — it shares the telemetry spine.",
    ];
    const survivors = mustFail.filter((s) => !staleBillingOrV4(s));
    expect(survivors, `these stale statements were NOT rejected:\n${survivors.join('\n')}`).toEqual([]);
  });

  it('billing/v4 guard ALLOWS legitimate switch/validation statements (PASS fixtures)', () => {
    const mustPass = [
      'Either payment switch — VITE_PAYMENTS_ENABLED or PAYMENTS_ENABLED — unset keeps checkout closed.',
      'Opening paid enrollment requires both payment switches ON plus aligned live keys, webhook, prices, and entitlement verification.',
      'The Stripe key class validates configuration but does not by itself open or close checkout.',
      'A key swap alone does not open paid enrollment; both switches must also be ON.',
      'The webhook signature is verified before any entitlement mutation, so Pro is never client-claimed.',
      'Private v4 is OFF; any future activation requires separate written authorization.',
      'A missing live config is fail-closed to the ConfigurationNeededPage, independent of the payment switches.',
    ];
    const wrongly = mustPass.filter((s) => staleBillingOrV4(s));
    expect(wrongly, `these legitimate statements were wrongly rejected:\n${wrongly.join('\n')}`).toEqual([]);
  });

  // Regression proof: the guard would have flagged the exact stale text that shipped in the runbook /
  // roadmap before this fix (block-normalized, so multi-line phrasings are covered).
  it('billing/v4 guard flags the exact pre-fix runbook & roadmap statements', () => {
    const priorStale = [
      // PAID_OPS_HARDENING_RUNBOOK.md (pre-fix)
      'The kill switch is the publishable-key class plus webhook-signature-verified entitlement:',
      'Release rule: a production deploy MUST run `live`; `test`/`missing`/`unknown` hide/disable all public checkout surfaces',
      "Checkout kill switch behaves | `arePaymentsEnabledFor==='live'`; test/missing/unknown hide checkout",
      // ROADMAP.operational.md (pre-fix)
      'Going live is an Ops config cutover (swap to `sk_live`/`pk_live`/live `whsec`/live price IDs + register the live webhook + verify `stripeKeyClass==="live"`)',
      '**P2 (ops launch-day)**: live key swap, no money-test',
    ];
    const missed = priorStale.filter((s) => !staleBillingOrV4(s));
    expect(missed, `guard failed to flag known-stale statements:\n${missed.join('\n')}`).toEqual([]);
  });

  it('no active doc presents a live-money charge as a required proof/gate/launch-blocker', () => {
    const offenders = activeDocs.flatMap(scanDocForLiveMoney);
    expect(offenders, `live-money-as-required-proof claims:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('live-money policy guard REJECTS "live charge is required proof" statements (FAIL fixtures)', () => {
    const mustFail = [
      'No paid GO without a real live-money charge proven by Test.',
      'Broad public launch requires the same proof with live Stripe keys.',
      'A required cs_live checkout is the launch proof.',
      'The only remaining item is the decision to flip live keys.',
    ];
    const survivors = mustFail.filter((s) => !staleLiveMoneyPolicy(s));
    expect(survivors, `these mandatory-live-money statements were NOT rejected:\n${survivors.join('\n')}`).toEqual([]);
  });

  it('live-money policy guard ALLOWS the one consistent policy (PASS fixtures)', () => {
    const mustPass = [
      'The test-mode checkout→webhook→entitlement journey is the accepted functional proof.',
      'No real-money transaction is required as Dev/CI/QA or launch proof.',
      'Both payment switches plus aligned live configuration and verification are required for activation.',
      'A controlled live smoke is optional Ops diligence after separate authorization.',
      'Either payment switch OFF keeps checkout closed.',
    ];
    const wrongly = mustPass.filter((s) => staleLiveMoneyPolicy(s));
    expect(wrongly, `these consistent-policy statements were wrongly rejected:\n${wrongly.join('\n')}`).toEqual([]);
  });

  it('the active docs set is non-trivial (guard against an empty scan)', () => {
    const realFiles = activeDocs.filter((p) => statSync(p).isFile());
    expect(realFiles.length).toBeGreaterThan(10);
  });
});

describe('no personal / local-machine absolute paths in tracked docs (archives included)', () => {
  const docs = MD_ROOTS.flatMap((r) => collectMarkdown(r));

  it('every Markdown file under docs/ and product_release/ is free of personal machine paths', () => {
    const offenders = [];
    for (const doc of docs) {
      read(doc).split('\n').forEach((line, i) => {
        if (PERSONAL_PATH.test(line)) offenders.push(`${rel(doc)}:${i + 1}: ${line.trim().slice(0, 160)}`);
      });
    }
    expect(offenders, `personal machine paths found in tracked docs:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the personal-path guard flags local paths and allows portable examples', () => {
    // Fixtures are assembled from fragments so this test file itself carries no literal personal path
    // (keeping the repo-wide scan at zero while still exercising the detector at runtime).
    const U = ['U', 's', 'e', 'r', 's'].join('');
    const H = ['h', 'o', 'm', 'e'].join('');
    const mustFlag = [
      `file:///${U}/alice/frontend/src/App.tsx`,
      `/${U}/bob/speaksharp/x.md`,
      `file:///${H}/carol/app/main.ts`,
      `/${H}/dave/project/y.ts`,
      `C:\\${U}\\erin\\repo\\z.ts`,
    ];
    const mustAllow = [
      '/tmp/build-output',
      '$(pwd)/dist/app.js',
      '~/speaksharp/scripts/run.sh',
      './relative/path.ts',
      'https://github.com/relativityE/speaksharp/blob/d31102a8/frontend/src/App.tsx',
    ];
    expect(mustFlag.filter((s) => !PERSONAL_PATH.test(s)), 'guard MISSED a personal path').toEqual([]);
    expect(mustAllow.filter((s) => PERSONAL_PATH.test(s)), 'guard WRONGLY flagged a portable path').toEqual([]);
  });

  it('scans a non-trivial number of Markdown files (guard against an empty walk)', () => {
    expect(docs.length).toBeGreaterThan(10);
  });
});
