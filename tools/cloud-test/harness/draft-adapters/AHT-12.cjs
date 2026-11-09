'use strict';
const adapters=require('./source-adapters.cjs');
module.exports=(args)=>adapters.run('AHT-12',args);
module.exports.preflight=(caseConfig)=>adapters.configurationPreflight('AHT-12',caseConfig);
module.exports.contract={caseId:'AHT-12',sourceSha:adapters.SOURCE_SHA,requiredAssertions:adapters.CONTRACTS['AHT-12'].rows,requiredOracles:adapters.CONTRACTS['AHT-12'].oracles,requiredTakeCap:adapters.CONTRACTS['AHT-12'].takes,unimplementedRequiredAssertions:adapters.CONTRACTS['AHT-12'].unimplementedRequiredAssertions,sourceAssertions:require('./source-control-crosswalk.json').controls.filter(row=>row.cases.includes('AHT-12'))};


module.exports.contract.requiredStartPressCap=adapters.CONTRACTS['AHT-12'].startPresses;

module.exports.contract.additionalSourceRequirements=Object.freeze({});

module.exports.requiresCaptureDevice=(caseConfig)=>adapters.requiresCaptureDevice('AHT-12',caseConfig);
