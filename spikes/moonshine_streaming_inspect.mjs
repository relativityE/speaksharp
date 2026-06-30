import { readFileSync } from 'node:fs';
const DIR='/private/tmp/moonshine-models/moonshine-streaming-small-onnx';
const cfg=JSON.parse(readFileSync(DIR+'/config.json'));
console.log('FULL CONFIG:', JSON.stringify(cfg));
let ort;
try { ort = (await import('/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp/node_modules/onnxruntime-node/dist/index.js')).default
      || (await import('/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp/node_modules/onnxruntime-node/dist/index.js')); }
catch(e){ console.log('onnxruntime-node import error:', String(e.message||e).slice(0,160)); process.exit(1); }
for (const m of ['encoder_model_int8','decoder_model_int8','decoder_with_past_model_int8']){
  try{
    const s=await ort.InferenceSession.create(`${DIR}/${m}.onnx`);
    console.log(`\n${m}`);
    console.log('  IN :', s.inputNames.join(', '));
    console.log('  OUT:', s.outputNames.join(', '));
  }catch(e){ console.log(`\n${m} >>> LOAD ERROR (candidate blocker):`, String(e.message||e).slice(0,220)); }
}
