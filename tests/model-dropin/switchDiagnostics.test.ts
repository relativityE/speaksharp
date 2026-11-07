// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { sanitizeSelectionFailure, sanitizeSwitchOutcome } from './switchDiagnostics';

// A local home path is assembled at run time so the tracked source itself carries none (tests/deps/no-local-machine-paths).
const SENSITIVE = `https://user:secret-token@models.example.invalid/w.onnx?sig=abc ${['', 'Users', 'someone', 'private'].join('/')} transcript: hello world`;

describe('sanitized candidate-switch diagnostics',()=>{
  it('keeps only ok and whether the switched candidate is the requested one',()=>{
    expect(sanitizeSwitchOutcome({ok:true,candidate:'v2:base.en'},'v2:base.en')).toEqual({ok:true,candidateMatchesRequest:true});
    expect(sanitizeSwitchOutcome({ok:true,candidate:'parakeet:tdt-v3:int8'},'v2:base.en')).toEqual({ok:true,candidateMatchesRequest:false});
  });
  it('keeps an allowlisted failure code and never the free-text reason',()=>{
    for(const code of ['init_failed','teardown_failed','identity_mismatch','busy']){
      const d=sanitizeSwitchOutcome({ok:false,code,reason:SENSITIVE},'v2:base.en');
      expect(d).toEqual({ok:false,code});
      expect(JSON.stringify(d)).not.toMatch(/secret|example\.invalid|\/Users\/|transcript|hello/);
    }
  });
  it('records an unknown, malformed or missing outcome as unrecognized, never verbatim',()=>{
    for(const raw of [{ok:false,code:SENSITIVE,reason:SENSITIVE},{ok:false},null,undefined,'init_failed',{ok:'yes',code:'busy'},{code:'busy'}]){
      const d=sanitizeSwitchOutcome(raw,'v2:base.en');
      expect(d).toEqual({ok:false,code:'unrecognized_code'});
      expect(JSON.stringify(d)).not.toContain('secret');
    }
  });
});

describe('selection failure state is content-free and records the cause the switch drops', () => {
    it('keeps closed tokens, booleans and bounded numbers', () => {
        expect(sanitizeSelectionFailure({ runtimeState: 'ENGINE_INITIALIZING', modelStatus: 'init-failed', crossOriginIsolated: false,
            webgpuPresent: false, acquisitionFailures: [{ errorCode: 'timeout', cache: 'miss', totalMs: 5000.4 }] }))
            .toEqual({ runtimeState: 'ENGINE_INITIALIZING', modelStatus: 'init-failed', crossOriginIsolated: false, webgpuPresent: false,
                acquisitionFailures: [{ errorCode: 'timeout', cache: 'miss', totalMs: 5000 }] });
    });
    it('never copies free text, URLs or paths, and caps the rows', () => {
        const leak = 'https://example.invalid/models/x.onnx failed: secret transcript';
        const out = sanitizeSelectionFailure({ runtimeState: leak, modelStatus: leak, crossOriginIsolated: 'yes', webgpuPresent: 1,
            acquisitionFailures: Array.from({ length: 20 }, () => ({ errorCode: leak, cache: leak, totalMs: -1 })) });
        expect(JSON.stringify(out)).not.toContain('example.invalid');
        expect(JSON.stringify(out)).not.toContain('transcript');
        expect(out).toMatchObject({ runtimeState: 'other', modelStatus: 'other', crossOriginIsolated: null, webgpuPresent: null });
        expect(out.acquisitionFailures).toHaveLength(8);
        expect(out.acquisitionFailures[0]).toEqual({ errorCode: 'unrecognized', cache: null, totalMs: null });
    });
    it('an unavailable page state is recorded as absent, not invented', () => {
        expect(sanitizeSelectionFailure(null)).toEqual({ runtimeState: 'absent', modelStatus: 'absent', crossOriginIsolated: null,
            webgpuPresent: null, acquisitionFailures: [] });
    });
});
