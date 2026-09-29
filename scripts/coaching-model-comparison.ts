#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net
/**
 * COACHING MODEL COMPARISON — the same saved sessions through two or more Gemini models, judged exactly the way
 * production judges them.
 *
 * WHAT IS SHARED WITH PRODUCTION (imported, not copied): the prompt template (`buildCoachingPrompt`), the Focus
 * coaching text (`buildFocusCoachingText`), the generation config with its response schema
 * (`GEMINI_GENERATION_CONFIG`), the parser with the six-word budget (`parseSuggestions(…, { enforceWordBudget: true })`)
 * and the word counter (`countWords`). Two pieces live inside the handler and are COPIED here — the metrics text and
 * the 8,000-character transcript cap — so the script checks at start-up that production still contains them verbatim
 * and refuses to run if it does not.
 *
 * WHAT IT MEASURES, per model: success rate; every failure with its reason — in particular answers rejected ONLY for
 * exceeding the word budget (users see those as an error); words per phrase and how many land exactly ON the limit;
 * prompt, output and thinking tokens; cost; latency; and the model version Google actually served.
 * It does NOT judge coaching quality: `side-by-side.md` is for people to read, optionally blind (`--blind`).
 *
 * DIFFERENCES FROM PRODUCTION, on purpose: one attempt per call (production retries once, only on a transport
 * error or a 5xx, and never on a rejected answer — so a rejection here is a rejection there); no quota; no DB.
 *
 * DATA: use internal or consented sessions, and a PAID-tier key only. The local output contains transcripts and raw
 * model answers: keep it out of GitHub, CI artifacts and chat. The output directory is private to this OS user.
 * Google's pricing page states free-tier content is used to improve its products and paid-tier content is not.
 *
 * INPUT: JSON Lines, one session per line, the columns production reads from `sessions`:
 *   {"id","product","transcript","duration","total_words","filler_words","filler_counts","clarity_score","wpm",
 *    "pause_metrics","focus_context"?} — product is open_mic or focus_points. Every Focus session MUST have the
 *    actual saved topic, point labels, verdicts and detection times assembled as a FocusContext with kind=focus.
 *    The script refuses missing Focus context rather than silently scoring it as Open Mic.
 *   Export only an internal or consented set with transcript_state=available; the newest-one retention policy
 *   means older saved sessions cannot be recovered. Include sessions.product, and join each Focus session's
 *   objective brief, ordered points and objective evidence into focus_context. Do not paste the export into a PR.
 *
 * RUN (from the repository root):
 *   GEMINI_API_KEY=… deno run --allow-read --allow-write --allow-env --allow-net scripts/coaching-model-comparison.ts \
 *     --input=sessions.jsonl --models=gemini-3.6-flash,gemini-3.8-flash [--repeats=3] [--limit=50] [--blind] \
 *     [--delay-ms=500] [--out=runs/coaching-comparison/unique-run-id]
 *   --dry-run exercises the whole pipeline with canned answers and NO network or key.
 *
 * OUTPUT (in --out): calls.jsonl (every call, raw text included), summary.json, summary.md, side-by-side.md, and with
 * --blind a separate blind-key.json.
 */
import {
    buildCoachingPrompt, buildFocusCoachingText, countWords, COACHING_WORD_BUDGET, GEMINI_GENERATION_CONFIG,
    parseSuggestions, type FocusContext,
} from '../backend/supabase/functions/get-ai-suggestions/index.ts';

// ── Prices: Gemini Developer API, paid Standard tier, USD per 1M tokens, read from ai.google.dev pricing on
//    2026-09-29. Output price INCLUDES thinking tokens. Rates double on 2027-01-01 for the 3.6/3.7/3.8 Flash models.
//    A model not listed here gets cost = null rather than a guess.
const PRICES: Record<string, { input: number; output: number }> = {
    'gemini-3.6-flash': { input: 0.75, output: 3.75 },
    'gemini-3.7-flash': { input: 0.75, output: 3.75 },
    'gemini-3.8-flash': { input: 0.75, output: 3.75 },
    'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
};
const MAX_TRANSCRIPT_CHARS = 8000;

// ── Drift guard: the copied pieces must still be production's, verbatim.
const PRODUCTION_SOURCE = new URL('../backend/supabase/functions/get-ai-suggestions/index.ts', import.meta.url);
const MUST_STILL_CONTAIN = [
    'const MAX_TRANSCRIPT_CHARS = 8000;',
    '? `${session.transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\\n\\n[Transcript truncated for coaching request length.]`',
    'const fillerEvidence = session.filler_counts ?? session.filler_words;',
    "- Words Per Minute (WPM): ${session.wpm ?? 'N/A'}",
    "- Clarity Score: ${session.clarity_score ?? 'N/A'}%",
    "- Total Words: ${session.total_words ?? 'N/A'}",
    "- Duration: ${session.duration ?? 'N/A'} seconds",
    "- Pause Metrics: ${session.pause_metrics == null ? 'N/A' : JSON.stringify(session.pause_metrics)}",
    "- Filler Words: ${fillerEvidence == null ? 'N/A' : JSON.stringify(fillerEvidence)}",
    '` + buildFocusCoachingText(focusContext);',
    'contents: [{ parts: [{ text: prompt }] }],',
    'generationConfig: GEMINI_GENERATION_CONFIG,',
];

interface SessionRow {
    id: string; product: 'open_mic' | 'focus_points'; transcript: string; duration: unknown; total_words: unknown; filler_words: unknown;
    filler_counts: unknown; clarity_score: unknown; wpm: unknown; pause_metrics: unknown; focus_context?: FocusContext;
}
/** The parts of a generateContent response this script reads. */
interface GeminiResponse {
    modelVersion?: unknown;
    candidates?: { content?: { parts?: { text?: unknown }[] } }[];
    usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; thoughtsTokenCount?: unknown };
}
type Outcome = 'ok' | 'over_word_budget' | 'schema_invalid' | 'no_text' | 'provider_model_missing' | `http_${number}` | 'transport_error';
interface Call {
    sessionId: string; model: string; repeat: number; outcome: Outcome; latencyMs: number;
    observedModelVersion: string | null; modelVersionMatches: boolean | null;
    whatWorked: string | null; whatToTryNext: string | null; wordsWhatWorked: number | null; wordsTryNext: number | null;
    promptTokens: number | null; outputTokens: number | null; thoughtsTokens: number | null; costUsd: number | null;
    focusSupplied: boolean; rawText: string | null;
}

// ── Exactly the handler's construction (guarded above).
function transcriptForPrompt(transcript: string): string {
    return transcript.length > MAX_TRANSCRIPT_CHARS
        ? `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n[Transcript truncated for coaching request length.]`
        : transcript;
}
function metricsText(session: SessionRow, focusContext: FocusContext): string {
    const fillerEvidence = session.filler_counts ?? session.filler_words;
    return `
      Metrics:
      - Words Per Minute (WPM): ${session.wpm ?? 'N/A'}
      - Clarity Score: ${session.clarity_score ?? 'N/A'}%
      - Total Words: ${session.total_words ?? 'N/A'}
      - Duration: ${session.duration ?? 'N/A'} seconds
      - Pause Metrics: ${session.pause_metrics == null ? 'N/A' : JSON.stringify(session.pause_metrics)}
      - Filler Words: ${fillerEvidence == null ? 'N/A' : JSON.stringify(fillerEvidence)}
    ` + buildFocusCoachingText(focusContext);
}

/** The answer production would accept; if not, why not. */
export function classify(rawText: string | null): { outcome: Outcome; worked: string | null; next: string | null } {
    if (typeof rawText !== 'string') return { outcome: 'no_text', worked: null, next: null };
    const accepted = parseSuggestions(rawText, { enforceWordBudget: true });
    if (accepted) return { outcome: 'ok', worked: accepted.what_worked, next: accepted.what_to_try_next };
    const shapeOnly = parseSuggestions(rawText); // same parser, budget not enforced
    if (shapeOnly) return { outcome: 'over_word_budget', worked: shapeOnly.what_worked, next: shapeOnly.what_to_try_next };
    return { outcome: 'schema_invalid', worked: null, next: null };
}

const arg = (name: string) => Deno.args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => Deno.args.includes(`--${name}`);
const pct = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x: number | null, d = 2) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Canned provider for --dry-run: a valid answer (5+5 words), one over budget (7 words), one not JSON, cycling. */
function dryRunResponse(model: string, n: number): { status: number; body: GeminiResponse } {
    const answers = [
        { version: 'gemini_coaching_v1', what_worked: 'Clear opening grabbed attention fast.', what_to_try_next: 'Pause after each key point.' },
        { version: 'gemini_coaching_v1', what_worked: 'Your opening story really grabbed everyone\'s attention.', what_to_try_next: 'Slow down.' },
    ];
    const text = n % 3 === 2 ? 'not json' : JSON.stringify(answers[n % 2]);
    return { status: 200, body: { modelVersion: model, candidates: [{ content: { parts: [{ text }] } }],
        usageMetadata: { promptTokenCount: 900 + n, candidatesTokenCount: 30, thoughtsTokenCount: 120 } } };
}

async function main() {
    const dryRun = flag('dry-run');
    const input = arg('input'); const models = (arg('models') ?? 'gemini-3.6-flash,gemini-3.8-flash').split(',').map((m) => m.trim()).filter(Boolean);
    const repeats = Number(arg('repeats') ?? 1); const limit = arg('limit') ? Number(arg('limit')) : Infinity;
    const delayMs = Number(arg('delay-ms') ?? 500); const out = arg('out') ?? 'runs/coaching-comparison';
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!input) throw new Error('--input=<sessions.jsonl> is required');
    if (!dryRun && !apiKey) throw new Error('GEMINI_API_KEY is not set (use a PAID-tier key), or pass --dry-run');
    if (!dryRun && Date.now() >= Date.UTC(2027, 0, 1))
        throw new Error('the hard-coded 2026 pricing expired; update PRICES against the official paid Standard price sheet');
    if (!Number.isSafeInteger(repeats) || repeats < 1) throw new Error('--repeats must be a positive integer');
    if (!(limit === Infinity || (Number.isSafeInteger(limit) && limit > 0))) throw new Error('--limit must be a positive integer');
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error('--delay-ms must be nonnegative');
    if (models.length < 2 || new Set(models).size !== models.length || models.some((m) => !Object.hasOwn(PRICES, m)))
        throw new Error('provide at least two distinct models listed in PRICES');

    const source = await Deno.readTextFile(PRODUCTION_SOURCE);
    const drifted = MUST_STILL_CONTAIN.filter((s) => !source.includes(s));
    if (drifted.length) throw new Error(`production no longer builds the request this way; update this script:\n  ${drifted.join('\n  ')}`);

    const sessions: SessionRow[] = (await Deno.readTextFile(input)).split('\n').filter((l) => l.trim())
        .map((l, i) => { try { return JSON.parse(l); } catch { throw new Error(`input line ${i + 1} is not JSON`); } })
        .filter((s) => s && typeof s === 'object' && typeof s.transcript === 'string' && s.transcript.trim()).slice(0, limit);
    if (!sessions.length) throw new Error('no sessions with a transcript in the input');
    for (const session of sessions) {
        if (!session.id || (session.product !== 'open_mic' && session.product !== 'focus_points'))
            throw new Error('every row needs an id and an explicit open_mic or focus_points product');
        if (session.product === 'focus_points' &&
            (session.focus_context?.kind !== 'focus' || !Array.isArray(session.focus_context.points) || !session.focus_context.points.length))
            throw new Error(`Focus session ${session.id} needs its saved topic, points and results in focus_context`);
        if (session.focus_context?.kind === 'focus' &&
            (typeof session.focus_context.topic !== 'string' && session.focus_context.topic !== null ||
                session.focus_context.points.some((p) => typeof p.label !== 'string' ||
                    !['detected', 'not_detected', 'unavailable'].includes(p.verdict) ||
                    (p.detectedAtSeconds !== null && typeof p.detectedAtSeconds !== 'number'))))
            throw new Error(`Focus session ${session.id} has malformed saved point evidence`);
        if (session.product === 'open_mic' && session.focus_context && session.focus_context.kind !== 'none')
            throw new Error(`Open Mic session ${session.id} cannot carry Focus coaching context`);
    }

    await Deno.mkdir(out, { recursive: true, mode: 0o700 });
    await Deno.chmod(out, 0o700);
    for await (const _entry of Deno.readDir(out))
        throw new Error('--out must name an empty directory; keep every comparison attempt separate');
    const callsFile = await Deno.open(`${out}/calls.jsonl`, { write: true, create: true, truncate: true, mode: 0o600 });
    const calls: Call[] = []; let n = 0;
    const total = sessions.length * models.length * repeats;

    for (const session of sessions) {
        const focus: FocusContext = session.focus_context ?? { kind: 'none' };
        const prompt = buildCoachingPrompt(transcriptForPrompt(session.transcript), metricsText(session, focus));
        for (let repeat = 1; repeat <= repeats; repeat++) {
            for (const model of models) { // interleaved, so drift over time affects every model alike
                const started = performance.now(); let status = 0; let body: GeminiResponse | string | null = null; let transport = false;
                if (dryRun) ({ status, body } = dryRunResponse(model, n));
                else {
                    try {
                        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: GEMINI_GENERATION_CONFIG }),
                        });
                        status = res.status; body = res.ok ? (await res.json()) as GeminiResponse : await res.text();
                    } catch { transport = true; }
                }
                const latencyMs = Math.round(performance.now() - started);
                const json: GeminiResponse | null = status === 200 && typeof body === 'object' ? body : null;
                const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
                const rawText = typeof text === 'string' ? text : null;
                const parsed = transport ? { outcome: 'transport_error' as Outcome, worked: null, next: null }
                    : status !== 200 ? { outcome: `http_${status}` as Outcome, worked: null, next: null } : classify(rawText);
                const u = json?.usageMetadata ?? {};
                const promptTokens = typeof u.promptTokenCount === 'number' ? u.promptTokenCount : null;
                const outputTokens = typeof u.candidatesTokenCount === 'number' ? u.candidatesTokenCount : null;
                const thoughtsTokens = typeof u.thoughtsTokenCount === 'number' ? u.thoughtsTokenCount : 0;
                const price = PRICES[model];
                const costUsd = price && promptTokens !== null && outputTokens !== null
                    ? (promptTokens * price.input + (outputTokens + thoughtsTokens) * price.output) / 1e6 : null;
                const observed = typeof json?.modelVersion === 'string' ? json.modelVersion : null;
                // Production requires both a valid pair and an allowlisted provider model receipt before it saves.
                const c = status === 200 && (observed === null || !/^[A-Za-z0-9._:-]{1,128}$/.test(observed))
                    ? { outcome: 'provider_model_missing' as Outcome, worked: parsed.worked, next: parsed.next }
                    : parsed;
                const call: Call = {
                    sessionId: String(session.id), model, repeat, outcome: c.outcome, latencyMs,
                    observedModelVersion: observed, modelVersionMatches: observed === null ? null : observed === model,
                    whatWorked: c.worked, whatToTryNext: c.next,
                    wordsWhatWorked: c.worked === null ? null : countWords(c.worked), wordsTryNext: c.next === null ? null : countWords(c.next),
                    promptTokens, outputTokens, thoughtsTokens: status === 200 ? thoughtsTokens : null, costUsd,
                    focusSupplied: session.product === 'focus_points', rawText,
                };
                calls.push(call); n++;
                await callsFile.write(new TextEncoder().encode(JSON.stringify(call) + '\n'));
                console.log(`[${n}/${total}] ${model} ${session.id} #${repeat}: ${call.outcome} ${latencyMs}ms`);
                if (!dryRun && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
            }
        }
    }
    callsFile.close();

    // ── Summary per model.
    const budget = COACHING_WORD_BUDGET;
    const summary = models.map((model) => {
        const cs = calls.filter((c) => c.model === model); const ok = cs.filter((c) => c.outcome === 'ok');
        const answered = cs.filter((c) => c.outcome === 'ok' || c.outcome === 'over_word_budget' || c.outcome === 'schema_invalid');
        const outcomes: Record<string, number> = {}; cs.forEach((c) => { outcomes[c.outcome] = (outcomes[c.outcome] ?? 0) + 1; });
        const words = ok.flatMap((c) => [c.wordsWhatWorked!, c.wordsTryNext!]);
        const costs = cs.map((c) => c.costUsd).filter((x): x is number => x !== null);
        return {
            model, calls: cs.length, outcomes,
            acceptedRateOfAnswered: answered.length ? round(ok.length / answered.length, 4) : null,
            overWordBudgetRateOfAnswered: answered.length ? round(cs.filter((c) => c.outcome === 'over_word_budget').length / answered.length, 4) : null,
            phrasesOnTheLimit: words.filter((w) => w === budget.what_worked).length, phrasesAccepted: words.length,
            meanWordsPerPhrase: round(mean(words)),
            latencyMs: { p50: pct(cs.map((c) => c.latencyMs), 50), p95: pct(cs.map((c) => c.latencyMs), 95) },
            meanTokens: { prompt: round(mean(cs.map((c) => c.promptTokens).filter((x): x is number => x !== null))),
                output: round(mean(cs.map((c) => c.outputTokens).filter((x): x is number => x !== null))),
                thinking: round(mean(cs.map((c) => c.thoughtsTokens).filter((x): x is number => x !== null))) },
            meanCostPerCallUsd: round(mean(costs), 6), costPer1000CallsUsd: costs.length ? round(mean(costs)! * 1000, 2) : null,
            servedModelVersions: [...new Set(cs.map((c) => c.observedModelVersion).filter(Boolean))],
            modelVersionMismatches: cs.filter((c) => c.modelVersionMatches === false).length,
        };
    });
    const meta = { generatedAt: new Date().toISOString(), dryRun, sessions: sessions.length, repeats, models,
        focusSessions: sessions.filter((s) => s.product === 'focus_points').length,
        wordBudget: budget, prices: PRICES, pricesNote: 'paid Standard tier, read 2026-09-29; output includes thinking tokens; 3.6-3.8 Flash double on 2027-01-01' };
    await Deno.writeTextFile(`${out}/summary.json`, JSON.stringify({ meta, summary }, null, 2), { mode: 0o600 });

    const md = [`# Coaching model comparison${dryRun ? ' (DRY RUN — canned answers, not a result)' : ''}`, '',
        `${sessions.length} sessions × ${repeats} repeat(s); word budget ${budget.what_worked}/${budget.what_to_try_next}. Rates are over answered calls (HTTP and transport failures listed separately).`, '',
        '| Model | Calls | Accepted | Over word budget | Phrases on the limit | Mean words | p50 / p95 ms | Tokens in / out / thinking | Cost per 1,000 calls |',
        '|---|---|---|---|---|---|---|---|---|',
        ...summary.map((s) => `| ${s.model} | ${s.calls} | ${s.acceptedRateOfAnswered === null ? '—' : (s.acceptedRateOfAnswered * 100).toFixed(1) + '%'} | ${s.overWordBudgetRateOfAnswered === null ? '—' : (s.overWordBudgetRateOfAnswered * 100).toFixed(1) + '%'} | ${s.phrasesOnTheLimit}/${s.phrasesAccepted} | ${s.meanWordsPerPhrase ?? '—'} | ${s.latencyMs.p50} / ${s.latencyMs.p95} | ${s.meanTokens.prompt} / ${s.meanTokens.output} / ${s.meanTokens.thinking} | ${s.costPer1000CallsUsd === null ? '—' : '$' + s.costPer1000CallsUsd} |`),
        '', 'All outcomes per model:', ...summary.map((s) => `- ${s.model}: ${JSON.stringify(s.outcomes)}; served ${s.servedModelVersions.join(', ') || '—'}${s.modelVersionMismatches ? `; ${s.modelVersionMismatches} served a different model` : ''}`),
        '', 'Coaching quality is NOT measured here: read side-by-side.md.'];
    await Deno.writeTextFile(`${out}/summary.md`, md.join('\n') + '\n', { mode: 0o600 });

    // ── Side-by-side for people; --blind hides which model wrote which.
    const blind = flag('blind'); const key: Record<string, Record<string, string>> = {};
    const sbs = ['# Side by side' + (blind ? ' (blind — see blind-key.json afterwards)' : ''), ''];
    for (const session of sessions) {
        const order = blind ? [...models].sort(() => Math.random() - 0.5) : models;
        if (blind) key[session.id] = Object.fromEntries(order.map((m, i) => [String.fromCharCode(65 + i), m]));
        sbs.push(`## Session ${session.id} (${session.product})`, '', `WPM ${session.wpm ?? 'N/A'} · clarity ${session.clarity_score ?? 'N/A'}% · words ${session.total_words ?? 'N/A'} · ${session.duration ?? 'N/A'} s · fillers ${JSON.stringify(session.filler_counts ?? session.filler_words ?? null)} · pauses ${JSON.stringify(session.pause_metrics ?? null)}`, '');
        const escapedTranscript = transcriptForPrompt(session.transcript).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        sbs.push('<details><summary>Transcript sent to provider — sensitive, local only</summary>', '', '<pre>' + escapedTranscript + '</pre>', '', '</details>', '');
        if (session.product === 'focus_points') {
            const escapedFocus = JSON.stringify(session.focus_context).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            sbs.push('<pre>Focus context: ' + escapedFocus + '</pre>', '');
        }
        order.forEach((m, i) => {
            const label = blind ? `Model ${String.fromCharCode(65 + i)}` : m;
            calls.filter((c) => c.sessionId === String(session.id) && c.model === m).forEach((c) => {
                sbs.push(c.outcome === 'ok' ? `- **${label}** #${c.repeat}: ✓ ${c.whatWorked} · → ${c.whatToTryNext}`
                    : `- **${label}** #${c.repeat}: ✗ ${c.outcome}${c.whatWorked ? ` (would have shown: ${c.whatWorked} [${c.wordsWhatWorked}w] · ${c.whatToTryNext} [${c.wordsTryNext}w])` : ''}`);
            });
        });
        sbs.push('');
    }
    await Deno.writeTextFile(`${out}/side-by-side.md`, sbs.join('\n'), { mode: 0o600 });
    if (blind) await Deno.writeTextFile(`${out}/blind-key.json`, JSON.stringify(key, null, 2), { mode: 0o600 });
    for (const file of ['calls.jsonl', 'summary.json', 'summary.md', 'side-by-side.md', ...(blind ? ['blind-key.json'] : [])])
        await Deno.chmod(`${out}/${file}`, 0o600);
    console.log(`\n${md.slice(4, 6 + summary.length).join('\n')}\n\nwritten to ${out}/`);
}

if (import.meta.main) await main();
