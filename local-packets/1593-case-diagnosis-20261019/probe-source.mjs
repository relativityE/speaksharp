// Read-only executed-source probes. No live browser, model, provider or account operations.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const head = 'ecce3e8d9e154ddb12f7238a514f0ec85d4b75b4';
const sourceHashes = {};
const read = (path) => {
    const text = execFileSync('git', ['show', `${head}:${path}`], { encoding: 'utf8' });
    sourceHashes[path] = createHash('sha256').update(text).digest('hex');
    return text;
};
const focus = read('tests/live/helpers/rwtFocusPointsJourney.ts');
const manifest = JSON.parse(read('tests/fixtures/rwt/rwt-fixtures.manifest.json'));
const fixture = manifest.fixtures?.focus_points_partial_tts ?? manifest.focus_points_partial_tts;
if (!fixture) throw new Error('fixture shape changed');
const markerSlice = focus.slice(focus.indexOf('const verdicts = points.map'), focus.indexOf('const ok = verdicts.every'));
const markerJs = ts.transpileModule(`${markerSlice}\nreturn verdicts;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const marker = new Function('points', 'windows', 'firstChange', 'takeOpen', 'expectedFinal', 'expectsLiveChange', 'MARKER_ALIGNMENT_SLACK_SECONDS', 'LIVE_MARKER_MAX_AFTER_SECONDS', `const nextStart=(i)=>{for(let j=i+1;j<windows.length;j++){if(windows[j])return windows[j][0];}return null;};\n${markerJs}`);
const observed = [{ atMs: 9400 }, { atMs: 15700 }, { atMs: 21500 }, null];
const markerVerdicts = marker(fixture.points, fixture.pointAudioWindows, observed, 0, fixture.expectedFinal, () => true, 1, 5);
const deadline = Math.min(fixture.pointAudioWindows[0][1] + 5, fixture.pointAudioWindows[1][0]);
if (!markerVerdicts[0].startsWith('late@9.4') || deadline !== 9.02) throw new Error('original marker oracle did not reproduce');

const lifecycle = read('frontend/src/hooks/useSessionLifecycle.ts');
const expr = lifecycle.match(/isButtonDisabled: ([\s\S]*?),\n\s*usageLimit/)[1];
const parentDisabled = new Function('runtimeState', 'isTranscriptFinalizing', 'isPrivateStartBlockedByModelState', `return (${expr});`);
const card = read('frontend/src/components/session/MicCard.tsx');
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(card, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { module, exports: module.exports, require: (name) => name === 'react' ? React : name.endsWith('/journeyStep') ? { emitJourneyStep() {} } : require(name) });
const render = (runtime, finalizing) => {
    const html = renderToStaticMarkup(React.createElement(module.exports.MicCard, { onStart() {}, privateModelStatus: 'idle', starting: false, blockedReason: null, disabled: parentDisabled(runtime, finalizing, false) }));
    const tag = html.match(/<button[^>]*data-testid="mic-start"[^>]*>/)[0];
    return { modelStatus: 'idle', ariaLabel: tag.match(/aria-label="([^"]*)"/)[1], disabled: tag.includes('disabled=""'), control: 'mic-start' };
};
const transitional = render('ENGINE_INITIALIZING', false);
const finalizing = render('IDLE', true);
const clear = render('IDLE', false);
if (JSON.stringify(transitional) !== JSON.stringify(finalizing) || !transitional.disabled || clear.disabled) throw new Error('rendered ambiguity control failed');

const abandon = read('tests/live/rwt-abandon-and-two-tabs.live.spec.ts');
const leaveStart = abandon.indexOf("if (variant === 'navigate-away')");
const leaveEnd = abandon.indexOf('} else {', leaveStart);
const leave = abandon.slice(leaveStart, leaveEnd);
const prepareB = abandon.indexOf('const setupB = await preparePrivateModelIfPrompted');
const refuseB = abandon.indexOf('const leaseRefusal =', prepareB);
if (!leave.includes("openProductsItem(page, 'focus-points')") || !leave.includes("openProductsItem(page, 'open-mic')") || leave.includes("keyboard.press('Escape')") || !(prepareB < refuseB)) throw new Error('executed-source ordering changed');

const result = {
    executedHead: head, sourceHashes,
    case3: { originalOracleResult: markerVerdicts, firstDeadlineSeconds: deadline, firstObservedSeconds: 9.4,
        counterexample: 'A transition at8.90 and one at9.10 can both first be observed at9.40; identical retained receipt, different actual deadline outcomes. The receipt proves late observation, not uniquely late product emission.',
        pollWaitMs: 500, firstPreviousObservationTimeRetained: false, noLiveReproductionClaimed: true },
    case4: { actualCardRender: { transitional, finalizing, clear }, conclusion: 'Plain disabled Start with model idle does not uniquely distinguish runtime-transition versus transcript-finalization gate. It cannot name the historical blocker.' },
    case9: { executedSourceHasFocusThenProductsReturnWithoutClosingSetup: true, retainedLogProvesDialogIntercept: true, newBrowserExecution: false },
    case11: { modelPreparationAwaitPrecedesLeaseRefusalObservation: true, harnessContractConflict: true, historicalLeaseRefusalIndependentlyObserved: false },
    controls: { markerOracleReplay: 'PASS', renderedGateAliasing: 'PASS', clearGateNegative: 'PASS', harnessOrderChecks: 'PASS' },
    modelRuns: 0, liveRuns: 0, providerCalls: 0, accountOperations: 0,
};
writeFileSync(new URL('source-probe-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
