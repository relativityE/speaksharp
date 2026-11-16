import { BaseSequencer } from 'vitest/node';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { durationBalancedShards } from './ci-duration-shards.mjs';
export default class DurationSequencer extends BaseSequencer {
  readWeights() {
    try {
      const receipt=JSON.parse(readFileSync(new URL('./ci-unit-durations.json',import.meta.url),'utf8'));
      if(receipt.schemaVersion!==1 || !receipt.durationsMs || typeof receipt.durationsMs!=='object' || Array.isArray(receipt.durationsMs)) throw Error('INVALID_TIMINGS');
      return receipt.durationsMs;
    } catch { return null; }
  }
  async shard(files) {
    const weights=this.readWeights();
    if(!weights) return super.shard(files);
    const {index,count}=this.ctx.config.shard;
    if(!Number.isSafeInteger(index) || index<1 || index>count) throw Error('INVALID_SHARD_INDEX');
    const items=files.map(spec=>{
      const path=relative(this.ctx.config.root,spec.moduleId).split('\\').join('/');
      return {id:JSON.stringify([spec.project.name,path,spec.pool]),path,spec};
    });
    const groups=durationBalancedShards(items,count,weights);
    console.log(`[duration-shards] collected=${files.length} shard=${index}/${count} selected=${groups[index-1].items.length} estimatedMs=${Math.round(groups[index-1].estimatedMs)} (historical hint, not evidence)`);
    return groups[index-1].items.map(item=>item.spec);
  }
}
