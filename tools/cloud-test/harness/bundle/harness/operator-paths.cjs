'use strict';
const path=require('node:path');
function outside(file,protectedRoots,label){if(typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file)throw new Error('BLOCKED_SETUP: absolute canonical '+label+' required');for(const root of protectedRoots){const p=path.resolve(root);if(file===p||file.startsWith(p+path.sep))throw new Error('BLOCKED_SETUP: '+label+' must be outside checkout and immutable packet');}return file;}
function validateOperatorPaths({checkoutDir,packetRoot,output,privateInputs=[]}){const roots=[checkoutDir,packetRoot];if(roots.some(x=>typeof x!=='string'||!path.isAbsolute(x)))throw new Error('BLOCKED_SETUP: actual checkout/packet roots required');outside(output,roots,'run output');for(const input of privateInputs)outside(input,roots,'private input');return {privatePathsExternal:true};}
module.exports={outside,validateOperatorPaths};
