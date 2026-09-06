#!/usr/bin/env node
/**
 * #1424 G4 — an EXECUTED call to the model the product actually names.
 *
 * Every other test on this PR is a string assertion over a constant plus mocked response shapes. None of them
 * can tell us whether `gemini-3.6-flash` exists, answers, or answers in the shape `parseSuggestions` accepts.
 * The prompt was tuned against `gemini-3-flash-preview`; the risk of the migration is a SHAPE shift, and a
 * shape shift means every user gets a 502 instead of coaching. Only a real call can rule that out.
 *
 * Nothing here is restated from memory. The URL, the prompt template and the acceptance rule are all PARSED
 * out of the edge function, so a drift between this proof and the shipped code fails the proof rather than
 * silently proving the wrong thing.
 *
 * Content: the transcript is FABRICATED. No user data, no production database, no deploy.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const FN = resolve(process.cwd(), 'backend', 'supabase', 'functions', 'get-ai-suggestions', 'index.ts');
const src = readFileSync(FN, 'utf8');
const out = process.env.PROOF_OUT ?? 'artifacts/gemini-3.6-currency-proof.json';

const fail = (msg) => { console.error(`G4 FAIL: ${msg}`); process.exit(1); };

// ---- 1. The endpoint, taken from the product ------------------------------------------------------------
const urlMatch = /export const GEMINI_API_URL = '([^']+)'/.exec(src);
if (!urlMatch) fail('could not read GEMINI_API_URL from the edge function — coupling broken');
const GEMINI_API_URL = urlMatch[1];
const modelMatch = /\/models\/([^:]+):generateContent/.exec(GEMINI_API_URL);
if (!modelMatch) fail(`GEMINI_API_URL is not a generateContent model URL: ${GEMINI_API_URL}`);
const MODEL = modelMatch[1];

// ---- 2. The acceptance rule, taken from parseSuggestions ------------------------------------------------
const keysMatch = /JSON\.stringify\(Object\.keys\(candidate\)\.sort\(\)\) !== JSON\.stringify\(\[([^\]]+)\]\)/.exec(src);
if (!keysMatch) fail('could not read the required key set from parseSuggestions — coupling broken');
const REQUIRED_KEYS = [...keysMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
const versionMatch = /candidate\.version !== '([a-z0-9_]+)'/.exec(src);
if (!versionMatch) fail('could not read the required version literal from parseSuggestions — coupling broken');
const REQUIRED_VERSION = versionMatch[1];

// ---- 2b. The generation config, taken from the product ---------------------------------------------------
// Balanced-brace extraction, then JSON.parse. If the literal in the edge function stops being valid JSON this
// throws rather than quietly sending a different config than production does.
const cfgStart = src.indexOf('export const GEMINI_GENERATION_CONFIG = {');
if (cfgStart === -1) fail('could not read GEMINI_GENERATION_CONFIG from the edge function - coupling broken');
let depth = 0, cfgEnd = -1;
for (let i = src.indexOf('{', cfgStart); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { cfgEnd = i + 1; break; } }
}
if (cfgEnd === -1) fail('GEMINI_GENERATION_CONFIG literal is unbalanced - coupling broken');
let GENERATION_CONFIG;
try { GENERATION_CONFIG = JSON.parse(src.slice(src.indexOf('{', cfgStart), cfgEnd)); }
catch (e) { fail(`GEMINI_GENERATION_CONFIG is not parseable as JSON, so this proof cannot send what production sends: ${e.message}`); }
// The schema and the parser must agree. If they disagree, production asks the model for one contract and then
// rejects the answer against another - which is a 502 for every user, produced by our own code.
const schemaKeys = Object.keys(GENERATION_CONFIG?.responseSchema?.properties ?? {}).sort();
if (JSON.stringify(schemaKeys) !== JSON.stringify(REQUIRED_KEYS)) {
    fail(`the response schema asks for ${JSON.stringify(schemaKeys)} but parseSuggestions requires ${JSON.stringify(REQUIRED_KEYS)}`);
}
// Key sets agreeing is not enough. A bare STRING `version` lets the model return any version the schema
// considers valid and the parser then rejects, so the permitted VALUES must match the parser's literal too.
const schemaVersions = GENERATION_CONFIG?.responseSchema?.properties?.version?.enum;
if (!Array.isArray(schemaVersions) || schemaVersions.length !== 1 || schemaVersions[0] !== REQUIRED_VERSION) {
    fail(`the schema permits version values ${JSON.stringify(schemaVersions)} but parseSuggestions accepts only ${JSON.stringify(REQUIRED_VERSION)}`);
}

// ---- 3. The prompt, taken from the product ---------------------------------------------------------------
const promptMatch = /const prompt = `([\s\S]*?)`;/.exec(src);
if (!promptMatch) fail('could not read the prompt template from the edge function — coupling broken');
// The capture must be ONE template literal (Codex finding). Rewritten as `A ${x}` + `B ${y}`, the regex
// still matches - the first "`;" is at the very end - both substitutions still succeed, no ${ survives, and
// the proof would send literal backticks and a "+" that production never sends. A backtick inside the
// captured body is the tell, so refuse rather than proceed on a prompt we did not really read.
if (promptMatch[1].includes('`')) fail('the prompt is no longer a single template literal; this proof would send text the edge function never sends');

// A FABRICATED session. Deliberately mundane and short: the point is the response SHAPE, not its quality.
const FABRICATED_TRANSCRIPT =
    'Good morning everyone. Um, today I want to talk about how we schedule our weekly reviews. ' +
    'We have been running them on Fridays, and, uh, attendance has been low. I think moving them to ' +
    'Tuesday would help. That is the change I am proposing.';
const FABRICATED_METRICS = `
      Metrics:
      - Words Per Minute (WPM): 132
      - Clarity Score: 88%
      - Total Words: 44
      - Duration: 20 seconds
      - Pause Metrics: {"long_pauses":1}
      - Filler Words: {"um":1,"uh":1}
    `;

let prompt = promptMatch[1]
    .replace('${transcriptForPrompt}', FABRICATED_TRANSCRIPT)
    .replace('${metricsText}', FABRICATED_METRICS);
// Fail CLOSED if the template grew an interpolation this proof does not know how to fill: sending `${...}`
// to the model would prove the wrong prompt.
if (prompt.includes('${')) fail(`prompt template has an unsubstituted interpolation: ${/\$\{[^}]*\}/.exec(prompt)?.[0]}`);

// ---- 4. The call ------------------------------------------------------------------------------------------
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) fail('GEMINI_API_KEY is not set in this environment — the proof cannot run (this is a credential-availability blocker, not a result)');

console.log(`G4: calling model=${MODEL} via the URL exported by the edge function`);

// A 503 UNAVAILABLE ("high demand") is the model declining to answer RIGHT NOW; a 404 NOT_FOUND is the model
// not existing. Conflating them would let a transient spike read as "the endpoint is dead", or worse, let a
// genuinely retired endpoint hide behind "probably transient". Only the transient class is retried, and only
// a bounded number of times, because every attempt is billed.
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const ATTEMPTS = 4;
const started = Date.now();
let res;
let bodyText = '';
let attempt = 0;
for (attempt = 1; attempt <= ATTEMPTS; attempt++) {
    res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The SAME body shape the edge function sends.
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: GENERATION_CONFIG }),
    });
    bodyText = await res.text();
    if (res.ok || !RETRYABLE.has(res.status)) break;
    if (attempt === ATTEMPTS) break;
    const backoffMs = 5000 * 2 ** (attempt - 1);
    console.log(`G4: attempt ${attempt} got HTTP ${res.status} (retryable); waiting ${backoffMs}ms`);
    await new Promise((r) => setTimeout(r, backoffMs));
}
const elapsedMs = Date.now() - started;

// The raw body is retained as evidence. The transcript that produced it is fabricated, so this carries no
// user content. The API key is never written.
mkdirSync(dirname(resolve(process.cwd(), out)), { recursive: true });
writeFileSync(resolve(process.cwd(), out), JSON.stringify({
    model: MODEL, url: GEMINI_API_URL, http_status: res.status, elapsed_ms: elapsedMs,
    // The SHA this proof actually ran against. Claiming an exact head is worthless unless the evidence says
    // which commit produced it (Codex finding: a labeled pull_request run checks out the MERGE commit by
    // default, not the head, so the claim and the run can silently disagree).
    proven_sha: process.env.PROOF_SHA ?? null,
    attempts: attempt, fabricated_transcript: FABRICATED_TRANSCRIPT, raw_response: bodyText,
}, null, 2));
console.log(`G4: proven_sha=${process.env.PROOF_SHA ?? '(unset)'} http_status=${res.status} attempts=${attempt} elapsed_ms=${elapsedMs} evidence=${out}`);

if (res.status === 404) fail(`the model ${MODEL} does not exist at the URL the product calls — this is the endpoint being retired, not a spike`);
if (!res.ok && RETRYABLE.has(res.status)) {
    fail(`the model was still unavailable (HTTP ${res.status}) after ${ATTEMPTS} attempts. The model EXISTS - this is not a 404 - but it did not answer, so the response SHAPE remains unproven. Re-run the proof; do not read this as a pass.`);
}
if (!res.ok) fail(`the model returned HTTP ${res.status} — the endpoint the product calls is not usable`);

// ---- 5. The response must satisfy the SHIPPED acceptance rule ---------------------------------------------
let data;
try { data = JSON.parse(bodyText); } catch { fail('response body was not JSON'); }
console.log(`G4: modelVersion reported by the API = ${data?.modelVersion ?? '(absent)'}`);

const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
if (typeof rawText !== 'string') fail('response did not carry candidates[0].content.parts[0].text — the shape the edge function reads');

// parseSuggestions does NOT strip markdown fences; it calls JSON.parse on the trimmed text. Applying the same
// strictness here is the point — a fenced answer is a real 502 in production, and must fail this proof.
let parsed;
try { parsed = JSON.parse(rawText.trim()); } catch {
    fail(`the model's text is not bare JSON, which parseSuggestions rejects (502 for every user). First 80 chars: ${JSON.stringify(rawText.trim().slice(0, 80))}`);
}
if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('the model returned JSON that is not an object');
const gotKeys = Object.keys(parsed).sort();
if (JSON.stringify(gotKeys) !== JSON.stringify(REQUIRED_KEYS)) {
    fail(`key set mismatch — parseSuggestions requires exactly ${JSON.stringify(REQUIRED_KEYS)}, model returned ${JSON.stringify(gotKeys)}`);
}
if (parsed.version !== REQUIRED_VERSION) fail(`version literal mismatch — required ${REQUIRED_VERSION}, got ${JSON.stringify(parsed.version)}`);
for (const k of ['what_worked', 'what_to_try_next']) {
    if (typeof parsed[k] !== 'string' || parsed[k].trim() === '') fail(`${k} is not a non-empty string`);
}

// #1424 A2. The parser now REFUSES an over-budget answer, so "the model responds" is no longer enough: if
// 3.6 will not write to a six-word budget, every review 502s and the honest verdict is that the budget is
// unachievable with this prompt, not that the model is fine. Read the budget from the edge function so this
// cannot drift from what production enforces.
const budgetMatch = /export const COACHING_WORD_BUDGET = Object\.freeze\(\{([^}]*)\}\)/.exec(src);
if (!budgetMatch) fail('could not read COACHING_WORD_BUDGET from the edge function — coupling broken');
const BUDGET = Object.fromEntries([...budgetMatch[1].matchAll(/(\w+)\s*:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
const words = (v) => v.trim().split(/\s+/).filter(Boolean).length;
for (const [field, max] of Object.entries(BUDGET)) {
    const n = words(parsed[field]);
    console.log(`G4: ${field} = ${n} words (budget ${max})`);
    if (n > max) fail(`${field} came back at ${n} words against a ${max}-word budget, so parseSuggestions would REFUSE it and the user would get a 502. Text: ${JSON.stringify(parsed[field])}`);
}

console.log(`G4 PASS: ${MODEL} responded and its answer satisfies parseSuggestions exactly (keys=${JSON.stringify(gotKeys)}).`);
