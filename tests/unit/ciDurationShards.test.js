// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe,it,expect } from 'vitest';
import DurationSequencer from '../../scripts/ci-duration-sequencer.mjs';
import { durationBalancedShards } from '../../scripts/ci-duration-shards.mjs';
const items=Array.from({length:17},(_,i)=>({id:`project:${i}`,path:`test-${i}`,payload:i}));
const flatten=groups=>groups.flatMap(g=>g.items);
describe('duration scheduling never substitutes for test execution',()=>{
  it('assigns every discovered spec exactly once including new unknown tests',()=>{
    const groups=durationBalancedShards(items,4,{'test-0':90000,'test-1':60000});
    expect(flatten(groups).map(x=>x.id).sort()).toEqual(items.map(x=>x.id).sort());
    expect(new Set(flatten(groups)).size).toBe(items.length);
  });
  it('is independent of discovery order and avoids putting long files together',()=>{
    const weights={...Object.fromEntries(items.map(x=>[x.path,100])), 'test-0':90000,'test-1':80000,'test-2':70000,'test-3':60000};
    const plan=durationBalancedShards(items,4,weights);
    expect(durationBalancedShards([...items].reverse(),4,weights)).toEqual(plan);
    expect(plan.map(g=>g.items[0].path).sort()).toEqual(['test-0','test-1','test-2','test-3']);
  });
  it('invalid, zero and obsolete weights cannot omit a collected test',()=>{
    for(const value of [NaN,Infinity,-1,0,4000000,'999']) {
      const plan=durationBalancedShards(items,4,{'test-0':value,deleted:5000});
      expect(flatten(plan)).toHaveLength(items.length);
      expect(flatten(plan).every(x=>items.includes(x))).toBe(true);
    }
  });
  it('keeps same path in different projects as distinct specs',()=>{
    const specs=[{id:'one',path:'same'},{id:'two',path:'same'}];
    expect(flatten(durationBalancedShards(specs,2,{same:100}))).toHaveLength(2);
  });
  it('rejects duplicate spec identities and invalid shard counts',()=>{
    expect(()=>durationBalancedShards([items[0],items[0]],4)).toThrow();
    for(const count of [0,-1,1.5,65,NaN]) expect(()=>durationBalancedShards(items,count)).toThrow();
  });
  it('handles fewer tests than shards and empty collection without inventing tests',()=>{
    expect(flatten(durationBalancedShards(items.slice(0,2),4))).toHaveLength(2);
    expect(flatten(durationBalancedShards([],4))).toEqual([]);
  });
});

it('actual Vitest sequencer and missing/stale-data fallback conserve all specs',async()=>{
  const files=items.map(x=>({moduleId:'/repo/'+x.path,project:{name:'main'},pool:'forks'}));
  class MissingTimingSequencer extends DurationSequencer { readWeights(){return null;} }
  for(const Sequencer of [DurationSequencer,MissingTimingSequencer]) {
    const selected=[];
    for(let index=1;index<=4;index++) {
      const sequencer=new Sequencer({config:{root:'/repo',shard:{index,count:4}}});
      selected.push(...await sequencer.shard(files));
    }
    expect(selected).toHaveLength(files.length);
    expect(new Set(selected).size).toBe(files.length);
    expect(selected.every(file=>files.includes(file))).toBe(true);
  }
});

it('four actual Vitest invocations execute each fixture once',()=>{
  const root=mkdtempSync(join(tmpdir(),'duration-shard-execution-'));
  try {
    mkdirSync(join(root,'proof'));symlinkSync(resolve('node_modules'),join(root,'node_modules'),'dir');
    const sequencer=fileURLToPath(new URL('../../scripts/ci-duration-sequencer.mjs',import.meta.url));
    writeFileSync(join(root,'vitest.config.mjs'),`import DurationSequencer from ${JSON.stringify(sequencer)}; export default {test:{environment:'node',include:['*.test.js'],sequence:{sequencer:DurationSequencer},pool:'forks',maxWorkers:1,minWorkers:1}};`);
    for(let i=0;i<7;i++)writeFileSync(join(root,`case-${i}.test.js`),`import {it} from 'vitest';import {appendFileSync} from 'node:fs';it('executes',()=>appendFileSync(${JSON.stringify(join(root,'proof',String(i)))},'ran\\n'));`);
    const cli=join(dirname(createRequire(import.meta.url).resolve('vitest/package.json')),'vitest.mjs');
    for(let index=1;index<=4;index++) {
      const child=spawnSync(process.execPath,[cli,'run','--config','vitest.config.mjs',`--shard=${index}/4`],{cwd:root,encoding:'utf8',timeout:20000});
      expect(child.status).toBe(0);
    }
    for(let i=0;i<7;i++)expect(readFileSync(join(root,'proof',String(i)),'utf8')).toBe('ran\n');
  } finally {rmSync(root,{recursive:true,force:true});}
},30000);
