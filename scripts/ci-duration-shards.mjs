// Scheduling only: weights can never add/remove a collected test specification.
export function durationBalancedShards(items, count, weights = {}) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 64) throw Error('INVALID_SHARD_COUNT');
  const valid = Object.values(weights).filter(n => Number.isFinite(n) && n > 0 && n <= 3600000).sort((a,b)=>a-b);
  const fallback = valid.length ? valid[Math.floor(valid.length/2)] : 1000;
  const seen = new Set();
  const ranked = items.map(item => {
    if (!item || typeof item.id !== 'string' || seen.has(item.id)) throw Error('INVALID_OR_DUPLICATE_SPEC');
    seen.add(item.id);
    const measured = weights[item.path];
    return {item, weight:Number.isFinite(measured) && measured > 0 && measured <= 3600000 ? measured : fallback};
  }).sort((a,b)=>b.weight-a.weight || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
  const groups=Array.from({length:count},()=>({items:[],estimatedMs:0}));
  for(const {item,weight} of ranked) {
    const target=groups.reduce((best,group)=>group.estimatedMs < best.estimatedMs ? group : best,groups[0]);
    target.items.push(item);target.estimatedMs+=weight;
  }
  return groups;
}
