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

// ---- 3. The prompt, taken from the product ---------------------------------------------------------------
const promptMatch = /const prompt = `([\s\S]*?)`;/.exec(src);
if (!promptMatch) fail('could not read the prompt template from the edge function — coupling broken');

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
const started = Date.now();
const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The SAME body shape the edge function sends.
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
});
const elapsedMs = Date.now() - started;
const bodyText = await res.text();

// The raw body is retained as evidence. The transcript that produced it is fabricated, so this carries no
// user content. The API key is never written.
mkdirSync(dirname(resolve(process.cwd(), out)), { recursive: true });
writeFileSync(resolve(process.cwd(), out), JSON.stringify({
    model: MODEL, url: GEMINI_API_URL, http_status: res.status, elapsed_ms: elapsedMs,
    fabricated_transcript: FABRICATED_TRANSCRIPT, raw_response: bodyText,
}, null, 2));
console.log(`G4: http_status=${res.status} elapsed_ms=${elapsedMs} evidence=${out}`);

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

console.log(`G4 PASS: ${MODEL} responded and its answer satisfies parseSuggestions exactly (keys=${JSON.stringify(gotKeys)}).`);
