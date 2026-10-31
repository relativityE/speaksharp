// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { sanitizeSwitchOutcome } from './switchDiagnostics';

const SENSITIVE = 'https://user:secret-token@models.example.invalid/w.onnx?sig=abc /Users/someone/private transcript: hello world';

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
