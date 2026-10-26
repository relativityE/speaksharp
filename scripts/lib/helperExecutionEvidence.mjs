import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const hash = value => createHash('sha256').update(value).digest('hex');
export const HELPER_CONTRACTS = Object.freeze([{
  helperFile: 'tests/live/helpers/rwtMarkerObserver.ts',
  testFile: 'tests/unit/rwtMarkerObserver1593.test.ts',
  callables: ['armMarkerObserverInPage', 'freezeMarkerObserverInPage', 'classifyMarkerTiming'],
}, {
  helperFile:'tests/canary/canaryStopSaveOracle.ts', testFile:'tests/unit/canaryStopSaveOracle.test.ts',
  callables:['startOwnerId','isOwnedStopSettledInPage','responseMatchesTake','verifySavedReadback','collectCanaryStopSave'],
}, {
  helperFile:'tests/e2e/canaryLanding.ts', testFile:'tests/e2e/__tests__/canaryLanding.test.ts',
  callables:['isProgressRoutePathname','isExpectedAuthLanding'],
}, {
  helperFile:'tests/live/helpers/rwtJourney.ts', testFile:'tests/unit/progressReaderUrlPredicates.test.ts',
  callables:['analyticsThroughActions','backFromProgressRestoresSession'],
}, {
  helperFile:'tests/live/helpers/rwtOracles.ts', testFile:'tests/unit/rwtReadbackBindingReasons1258.test.ts',
  callables:['bindReadbackJourneys'],
}, {
  helperFile:'tests/live/helpers/rwtStepDiagnostics.ts', testFile:'tests/unit/rwtStepDiagnostics1258.test.ts',
  callables:['routeClass'],
}, {
  helperFile:'tests/live/helpers/rwtFillerReference.ts', testFile:'tests/unit/rwtFillerReference1258.test.ts',
  callables:['fillerAnnotationsOf','referenceKeyFor','referenceCount','alignFillers','corpusWordVerdict',
    'corpusVerdicts','corpusRows','hesitationTotals','integrityVerdict','crossCheckCounts'],
}]);
export const HELPER_CONFIG = 'scripts/efficacy-helper-vitest.config.mjs';

export function registeredHelper(file) {
  return HELPER_CONTRACTS.find(contract => contract.helperFile === file);
}

function regularFile(root, relative) {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || path.posix.normalize(relative) !== relative
    || relative.startsWith('../')) throw new Error('Invalid helper evidence path');
  const target = path.join(root, relative);
  if (!fs.lstatSync(target).isFile() || fs.realpathSync(target) !== target) throw new Error('Aliased helper source path');
  return target;
}

export function helperRuntimeIdentity(root) {
  const require = createRequire(path.join(root, 'package.json'));
  const packages = ['@vitest/coverage-v8', 'jsdom', '@jridgewell/trace-mapping', 'typescript'].map(name => {
    const location = require.resolve(`${name}/package.json`);
    const bytes = fs.readFileSync(location);
    return {name, version: JSON.parse(bytes).version, packageSha256: hash(bytes),
      entrySha256: hash(fs.readFileSync(require.resolve(name)))};
  });
  if (packages[0].version !== '3.2.4') throw new Error('Unsupported helper coverage provider');
  const provider = fs.realpathSync(require.resolve('@vitest/coverage-v8/dist/provider.js'));
  const bytes = fs.readFileSync(provider);
  const code = bytes.toString('utf8');
  // In pinned 3.2.4 the legacy converter and its helpers are embedded here,
  // not an independently installed v8-to-istanbul package. Bind the actual
  // resolved implementation, including the provider's patched constructor.
  const first = 'var convertSourceMap = {};';
  const last = 'var v8ToIstanbul = /*@__PURE__*/getDefaultExportFromCjs(v8ToIstanbulExports);';
  const call = 'const converter = v8ToIstanbul(filename, wrapperLength, sources, undefined, this.options.ignoreEmptyLines);';
  const begin = code.indexOf(first);
  const end = code.indexOf(last) + last.length;
  if (begin < 0 || end <= begin || code.split(first).length !== 2 || code.split(last).length !== 2
    || code.split(call).length !== 2) throw new Error('Unsupported embedded helper converter layout');
  const converter = {kind:'embedded-legacy-v8-to-istanbul', providerModule:'@vitest/coverage-v8/dist/provider.js',
    providerVersion:packages[0].version, startByte:Buffer.byteLength(code.slice(0,begin)),
    endByte:Buffer.byteLength(code.slice(0,end)), sha256:hash(code.slice(begin,end))};
  const normalizer=rangeNormalizer(root);
  return {packages, providerSha256: hash(bytes), converter,normalizer:normalizer.identity};
}

function rangeNormalizer(root) {
  const require=createRequire(path.join(root,'package.json'));
  const provider=fs.realpathSync(require.resolve('@vitest/coverage-v8/dist/provider.js'));
  const providerRequire=createRequire(provider);
  const entry=fs.realpathSync(providerRequire.resolve('@bcoe/v8-coverage'));
  const packageFile=providerRequire.resolve('@bcoe/v8-coverage/package.json');
  const metadata=fs.readFileSync(packageFile);
  if(JSON.parse(metadata).version!=='1.0.2') throw new Error('Unsupported helper range normalizer');
  const directory=path.dirname(entry);
  const sources=fs.readdirSync(directory).filter(file=>file.endsWith('.js')).sort().map(file=>{
    const target=path.join(directory,file);
    if(!fs.lstatSync(target).isFile() || fs.realpathSync(target)!==target) throw new Error('Aliased helper normalizer');
    return {file,sha256:hash(fs.readFileSync(target))};
  });
  return {merge:providerRequire('@bcoe/v8-coverage').mergeProcessCovs,
    identity:{name:'@bcoe/v8-coverage',version:'1.0.2',packageSha256:hash(metadata),sources}};
}

export function normalizedHelperWorkerFunctions(root,result) {
  // Replay the provider's real pre-remap merge on an untouched single-worker
  // payload. Adjacent equal-count branches may coalesce; counts may not change.
  const normalized=rangeNormalizer(root).merge([{result:[]},{result:structuredClone(result)}]);
  if(normalized.result.length!==1) throw new Error('Wrong helper normalization input');
  return normalized.result[0].functions;
}

export function helperSourceBinding(root, contract) {
  const files = [contract.helperFile, contract.testFile, HELPER_CONFIG,
    'frontend/vitest.config.mjs', 'scripts/coverage-thresholds.mjs',
    'scripts/lib/helperExecutionEvidence.mjs', 'pnpm-lock.yaml'];
  const setupFiles = fs.existsSync(path.join(root,'frontend/tests/setup.ts')) ? ['frontend/tests/setup.ts'] : [];
  files.push(...setupFiles);
  const sources = files.map(file => ({file, sha256: hash(fs.readFileSync(regularFile(root, file)))}));
  const source = fs.readFileSync(regularFile(root, contract.helperFile), 'utf8');
  // V8 remapping can set ignored function counters to 1 without a call.
  if (/\b(?:c8|v8|istanbul)\s+ignore\b/.test(source)) throw new Error('Coverage-ignore helper source is not supported');
  return {sources, runtime: helperRuntimeIdentity(root), callables: contract.callables, setupFiles};
}

export function helperCoverageOptions(root, binding) {
  if (!binding?.helper || !path.isAbsolute(binding.coverageDirectory || '')
    || !binding.coverageDirectory.startsWith(`${root}${path.sep}`)) throw new Error('Missing helper phase coverage directory');
  return {enabled: true, provider: 'custom',
    customProviderModule: path.join(root, 'scripts/lib/helperExecutionEvidence.mjs'),
    include: [binding.helper.helperFile], exclude: [], extension: ['.ts', '.js'],
    reporter: ['json'], reportsDirectory: binding.coverageDirectory,
    reportOnFailure: true, clean: true, cleanOnRerun: true, all: false,
    allowExternal: false, excludeAfterRemap: true, ignoreEmptyLines: false,
    ignoreClassMethods: [], experimentalAstAwareRemapping: false,
    // This dedicated callable-evidence phase is not the global percentage gate.
    // Its positive callable and provenance requirements are enforced by the consumer.
    thresholds: undefined};
}

const phaseBinding = () => {
  const binding = JSON.parse(process.env.TEST_EFFICACY_BINDING || 'null');
  if (!binding?.helper || !binding.phaseId) throw new Error('Missing bound helper coverage phase');
  return binding;
};

// Wrap the installed V8 provider rather than implementing a second test harness.
// The worker hook tags its actual inspector result; the main provider hook retains
// that RPC payload and the exact pre-remap code/map/functions from the same phase.
export default {
  async startCoverage(options) {
    const {default: v8} = await import('@vitest/coverage-v8');
    return v8.startCoverage(options);
  },
  async stopCoverage(options) {
    const {default: v8} = await import('@vitest/coverage-v8');
    return v8.stopCoverage(options);
  },
  async takeCoverage(options) {
    const {default: v8} = await import('@vitest/coverage-v8');
    const binding = phaseBinding();
    const coverage = await v8.takeCoverage(options);
    return {...coverage, helperProducer: {workerPid: process.pid,
      phaseId: binding.phaseId, bindingSha256: hash(JSON.stringify(binding))}};
  },
  async getProvider() {
    const {default: v8} = await import('@vitest/coverage-v8');
    const provider = await v8.getProvider();
    // Vitest sends resolveOptions().provider to workers. Leaving the delegate's
    // name as 'v8' would silently select its unwrapped worker module.
    provider.name = 'custom';
    const binding = phaseBinding();
    const actualRuntime = helperRuntimeIdentity(binding.cwd);
    if (JSON.stringify(actualRuntime) !== JSON.stringify(binding.helper.sourceBinding.runtime)) throw new Error('Helper converter runtime changed');
    const frames = [];
    const conversions = [];
    const originalSuite = provider.onAfterSuiteRun.bind(provider);
    provider.onAfterSuiteRun = meta => {
      if (!meta.coverage?.helperProducer) throw new Error('Helper coverage did not originate in the bound worker');
      const expected = path.join(binding.cwd, binding.helper.testFile);
      if (meta.testFiles?.length !== 1 || ![expected,binding.helper.testFile].includes(meta.testFiles[0])
        || fs.realpathSync(meta.testFiles[0]) !== expected) throw new Error('Wrong helper worker consumer');
      frames.push({testFiles: [expected], rawTestFiles: meta.testFiles, transformMode: meta.transformMode,
        producer: meta.coverage.helperProducer,
        result: structuredClone(meta.coverage.result.filter(item => item.url === new URL(`file://${path.join(binding.cwd, binding.helper.helperFile)}`).href))});
      return originalSuite(meta);
    };
    const originalConvert = provider.v8ToIstanbul.bind(provider);
    provider.v8ToIstanbul = async (filename, wrapperLength, sources, functions) => {
      if (fileURLToPath(filename) === path.join(binding.cwd, binding.helper.helperFile)) {
        const input = {filename, wrapperLength, sources: structuredClone(sources), functions: structuredClone(functions)};
        input.beforeRemap = {originalSourceSha256:hash(sources.originalSource),generatedSourceSha256:hash(sources.source),
          sourceMapSha256:hash(JSON.stringify(sources.sourceMap)),functionsSha256:hash(JSON.stringify(functions))};
        // Capture bytes before the provider remaps them; never reconstruct a map
        // later from expected output or a neighboring test's coverage summary.
        const converted = await originalConvert(filename, wrapperLength, sources, functions);
        conversions.push({...input, converted});
        return converted;
      }
      return originalConvert(filename, wrapperLength, sources, functions);
    };
    const originalReports = provider.generateReports.bind(provider);
    provider.generateReports = async (...args) => {
      await originalReports(...args);
      const payload = {schemaVersion: 1, bindingSha256: hash(JSON.stringify(binding)),
        phaseId: binding.phaseId, frames, conversions,
        report: JSON.parse(fs.readFileSync(path.join(binding.coverageDirectory,'coverage-final.json'),'utf8')),
        options: {include: provider.options.include, exclude: provider.options.exclude,
          reporter: provider.options.reporter, reportsDirectory: provider.options.reportsDirectory,
          reportOnFailure: provider.options.reportOnFailure, ignoreClassMethods: provider.options.ignoreClassMethods,
          experimentalAstAwareRemapping: provider.options.experimentalAstAwareRemapping,
          converter:actualRuntime,remappingMode:'legacy-v8-to-istanbul'}};
      fs.writeFileSync(path.join(binding.coverageDirectory, 'helper-raw.json'), JSON.stringify(payload));
    };
    return provider;
  },
};

export function validateHelperCoverage(raw, binding, root) {
  const contract = registeredHelper(binding?.helper?.helperFile);
  if (!contract || contract.testFile !== binding.helper.testFile) throw new Error('Unregistered helper/consumer edge');
  if (!path.isAbsolute(binding.cwd || '') || path.normalize(binding.cwd) !== binding.cwd
    || path.dirname(binding.coverageDirectory || '') !== binding.cwd
    || !path.basename(binding.coverageDirectory).startsWith('.helper-coverage-')) throw new Error('Aliased helper phase path');
  const expected = helperSourceBinding(root, contract);
  if (JSON.stringify(binding.helper.sourceBinding) !== JSON.stringify(expected)) throw new Error('Stale helper source/config/runtime binding');
  if (raw?.schemaVersion !== 1 || raw.phaseId !== binding.phaseId
    || raw.bindingSha256 !== hash(JSON.stringify(binding))) throw new Error('Wrong helper phase identity');
  const options = raw.options;
  if (!options || JSON.stringify(options.include) !== JSON.stringify([contract.helperFile])
    // Vitest excludes its selected test include from coverage automatically.
    || JSON.stringify(options.exclude) !== JSON.stringify([...expected.setupFiles,contract.testFile]) || JSON.stringify(options.reporter) !== '[["json",{}]]'
    || options.reportsDirectory !== binding.coverageDirectory || options.reportOnFailure !== true
    || JSON.stringify(options.ignoreClassMethods) !== '[]' || options.experimentalAstAwareRemapping !== false
    || JSON.stringify(options.converter) !== JSON.stringify(expected.runtime) || options.remappingMode !== 'legacy-v8-to-istanbul') {
    throw new Error('Wrong resolved helper coverage configuration');
  }
  if (raw.frames?.length !== 1 || raw.conversions?.length !== 1) throw new Error('Missing/duplicate helper worker or map');
  const frame = raw.frames[0];
  const producer = frame.producer;
  if (!Number.isInteger(producer?.workerPid) || producer.workerPid <= 0 || producer.phaseId !== binding.phaseId
    || producer.bindingSha256 !== raw.bindingSha256
    || JSON.stringify(frame.testFiles) !== JSON.stringify([path.join(binding.cwd, contract.testFile)])
    || frame.rawTestFiles?.length !== 1 || ![contract.testFile,path.join(binding.cwd,contract.testFile)].includes(frame.rawTestFiles[0])
    || !['web', 'ssr'].includes(frame.transformMode) || frame.result?.length !== 1) throw new Error('Wrong helper worker provenance');
  const conversion = raw.conversions[0];
  const filename = path.join(binding.cwd, contract.helperFile);
  if (conversion.filename !== new URL(`file://${filename}`).href || frame.result[0].url !== conversion.filename
    || !Number.isInteger(conversion.wrapperLength) || conversion.wrapperLength < 0
    || JSON.stringify(conversion.functions) !== JSON.stringify(normalizedHelperWorkerFunctions(root,frame.result))) throw new Error('Helper raw range/worker mismatch');
  const source = fs.readFileSync(regularFile(root, contract.helperFile), 'utf8');
  const sources = conversion.sources;
  const map = sources?.sourceMap?.sourcemap;
  if (sources?.originalSource !== source || typeof sources?.source !== 'string' || !sources.source
    || map?.version !== 3 || typeof map.mappings !== 'string' || !map.mappings || (map.ignoreList?.length ?? 0) > 0
    || JSON.stringify(map.sources) !== JSON.stringify([conversion.filename])
    || JSON.stringify(map.sourcesContent) !== JSON.stringify([source])) throw new Error('Invalid/incomplete helper source map');
  if (JSON.stringify(conversion.beforeRemap) !== JSON.stringify({originalSourceSha256:hash(source),generatedSourceSha256:hash(sources.source),
    sourceMapSha256:hash(JSON.stringify(sources.sourceMap)),functionsSha256:hash(JSON.stringify(conversion.functions))})) {
    throw new Error('Helper source/map identity changed after pre-remap capture');
  }
  const require = createRequire(path.join(root, 'package.json'));
  const ts = require('typescript');
  const {TraceMap, originalPositionFor,generatedPositionFor,GREATEST_LOWER_BOUND,LEAST_UPPER_BOUND} = require('@jridgewell/trace-mapping');
  const parsed = ts.createSourceFile(contract.helperFile, source, ts.ScriptTarget.Latest, true);
  const trace = new TraceMap(map);
  const mapped = conversion.converted?.[filename];
  if (!mapped || mapped.path !== filename) throw new Error('Wrong remapped helper path');
  if (JSON.stringify(raw.report) !== JSON.stringify(conversion.converted)) throw new Error('Helper JSON reporter differs from captured remapping');
  const originalAt = offset => {
    const prefix = sources.source.slice(0, offset).split('\n');
    return originalPositionFor(trace, {line: prefix.length, column: prefix.at(-1).length});
  };
  const sourceLines = source.split('\n');
  const generatedPoint=offset=>{
    const lines=sources.source.slice(0,Math.max(0,Math.min(offset,sources.source.trimEnd().length))).split('\n');
    return {line:lines.length,column:lines.at(-1).length};
  };
  const tryBoth=point=>{
    let result=originalPositionFor(trace,{...point,bias:GREATEST_LOWER_BOUND});
    if(result.line===null) result=originalPositionFor(trace,{...point,bias:LEAST_UPPER_BOUND});
    const minimum=originalPositionFor(trace,{line:point.line,column:0,bias:GREATEST_LOWER_BOUND});
    return minimum.line>result.line?minimum:result;
  };
  // Replay the pinned legacy converter's original-start/original-end mapping.
  // AST bounds below remain independent checks; an alternate plausible AST
  // column cannot replace the exact column established by this raw V8 range.
  const mappedSpan=range=>{
    const startPoint=generatedPoint(range.startOffset-conversion.wrapperLength);
    const endPoint=generatedPoint(range.endOffset-conversion.wrapperLength);
    const start=tryBoth(startPoint);
    const beforeEnd=tryBoth({line:endPoint.line,column:Math.max(endPoint.column-1,1)});
    if(start.source!==conversion.filename || beforeEnd.source!==conversion.filename) throw new Error('Unmapped helper callable boundary');
    const afterEnd=generatedPositionFor(trace,{source:beforeEnd.source,line:beforeEnd.line,column:beforeEnd.column+1,bias:LEAST_UPPER_BOUND});
    let end=afterEnd.line===null || originalPositionFor(trace,afterEnd).line!==beforeEnd.line
      ? {...beforeEnd,column:Infinity}:originalPositionFor(trace,afterEnd);
    if(start.line===end.line && start.column===end.column) {
      end=originalPositionFor(trace,{...endPoint,bias:LEAST_UPPER_BOUND});end.column--;
    }
    const clamp=point=>({line:point.line,column:Math.min(point.column,sourceLines[point.line-1]?.length ?? -1)});
    return {start:clamp(start),end:clamp(end)};
  };
  const before = (a,b) => a.line < b.line || (a.line === b.line && a.column < b.column);
  const executed = [];
  for (const name of contract.callables) {
    const declarations=[];
    for(const node of parsed.statements) {
      if(ts.isFunctionDeclaration(node) && node.name?.text===name) declarations.push(node);
      if(ts.isVariableStatement(node)) for(const item of node.declarationList.declarations) {
        if(ts.isIdentifier(item.name) && item.name.text===name && item.initializer && ts.isArrowFunction(item.initializer)) declarations.push(item.initializer);
      }
    }
    const declaration=declarations.length===1?declarations[0]:null;
    const functions = conversion.functions.filter(fn => fn.functionName === name);
    if (!declaration?.body || functions.length !== 1) throw new Error(`Missing/ambiguous helper callable: ${name}`);
    const fn = functions[0];
    if (fn.isBlockCoverage !== true || !fn.ranges?.length || fn.ranges[0].count <= 0) throw new Error(`Uncalled helper: ${name}`);
    for (const range of fn.ranges) {
      if (!Number.isInteger(range.count) || range.count < 0 || !Number.isInteger(range.startOffset)
        || !Number.isInteger(range.endOffset) || range.startOffset < conversion.wrapperLength
        || range.endOffset <= range.startOffset || range.endOffset - conversion.wrapperLength > sources.source.length) {
        throw new Error('Invalid helper executable range');
      }
      if (range.startOffset < fn.ranges[0].startOffset || range.endOffset > fn.ranges[0].endOffset) {
        throw new Error('Helper nested range escapes its callable');
      }
    }
    const start = parsed.getLineAndCharacterOfPosition(declaration.getStart(parsed));
    const end = parsed.getLineAndCharacterOfPosition(declaration.end);
    for (const range of fn.ranges) {
      for (const offset of [range.startOffset, range.endOffset - 1]) {
        const original = originalAt(offset - conversion.wrapperLength);
        if (original.source !== conversion.filename || original.line === null || original.column === null
          || original.line < start.line + 1 || original.line > end.line + 1
          || original.column < 0 || original.column > (source.split('\n')[original.line - 1]?.length ?? -1)) {
          throw new Error('Helper callable source-map range mismatch');
        }
      }
    }
    const entries = Object.entries(mapped.fnMap || {}).filter(([, value]) => value.name === name);
    if (entries.length !== 1 || !(mapped.f?.[entries[0][0]] > 0)) throw new Error(`Helper remapped callable not executed: ${name}`);
    if (mapped.f[entries[0][0]] !== fn.ranges[0].count) throw new Error('Remapped helper count contradicts raw worker count');
    const location = entries[0][1].loc;
    const expectedLocation=mappedSpan(fn.ranges[0]);
    const keyword = declaration.getChildren(parsed).find(node => node.kind === ts.SyntaxKind.FunctionKeyword);
    const bodyStart = parsed.getLineAndCharacterOfPosition(declaration.body.getStart(parsed));
    const bodyEnd = parsed.getLineAndCharacterOfPosition(declaration.body.end);
    // The pinned legacy converter maps transformed async declarations to the
    // declaration start (including export), not the inner function keyword.
    // Accept that exact AST boundary only for an actual async declaration.
    const asyncDeclaration=ts.isFunctionDeclaration(declaration)
      && declaration.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.AsyncKeyword);
    const functionStart = keyword ? parsed.getLineAndCharacterOfPosition(asyncDeclaration?declaration.getStart(parsed):keyword.getStart(parsed))
      : declaration && ts.isArrowFunction(declaration) ? parsed.getLineAndCharacterOfPosition(declaration.getStart(parsed)) : null;
    const typedArrow=ts.isArrowFunction(declaration) && (declaration.type || declaration.parameters.some(parameter=>parameter.type));
    const parameterStart=typedArrow && declaration.parameters[0]
      ? parsed.getLineAndCharacterOfPosition(declaration.parameters[0].getStart(parsed)):null;
    const statement=typedArrow && declaration.parent?.parent?.parent;
    const statementEnd=statement && ts.isVariableStatement(statement)
      && source.slice(declaration.end,statement.end)===';'
      ? parsed.getLineAndCharacterOfPosition(statement.end):null;
    const samePoint=(point,position)=>position && point.line===position.line+1 && point.column===position.character;
    const exactStart=samePoint(location?.start || {},functionStart)
      || parameterStart?.line===functionStart?.line && samePoint(location?.start || {},parameterStart);
    const exactEnd=samePoint(location?.end || {},bodyEnd) || samePoint(location?.end || {},statementEnd);
    const validPoint = point => Number.isInteger(point?.line) && point.line >= 1 && point.line <= sourceLines.length
      && Number.isInteger(point.column) && point.column >= 0 && point.column <= sourceLines[point.line - 1].length;
    if (!location || !Number.isInteger(location.start?.line) || !Number.isInteger(location.end?.line)
      || location.start.line < start.line + 1 || location.end.line > end.line + 1 || location.end.line < location.start.line
      || !Number.isInteger(location.start?.column) || !Number.isInteger(location.end?.column)
      || !validPoint(location.start) || !validPoint(location.end) || !before(location.start,location.end)
      || JSON.stringify(location)!==JSON.stringify(expectedLocation)
      || !functionStart || !exactStart || !exactEnd
      || before({line:bodyStart.line + 1,column:bodyStart.character},location.start)) {
      throw new Error(`Invalid remapped callable span: ${name}`);
    }
    executed.push({name, rawRanges: fn.ranges, sourceRange: {start, end}, remapped: entries[0][1], count: mapped.f[entries[0][0]]});
  }
  return {helperFile: contract.helperFile, consumer: contract.testFile,
    sourceSha256: hash(source), mapSha256: hash(JSON.stringify(map)), rawSha256: hash(JSON.stringify(raw)), executed};
}
