'use strict';
const adapters=require('./source-adapters.cjs');
module.exports=(args)=>adapters.run('AHT-11',args);
module.exports.preflight=(caseConfig)=>adapters.configurationPreflight('AHT-11',caseConfig);
module.exports.contract={caseId:'AHT-11',sourceSha:adapters.SOURCE_SHA,requiredAssertions:adapters.CONTRACTS['AHT-11'].rows,requiredOracles:adapters.CONTRACTS['AHT-11'].oracles,requiredTakeCap:adapters.CONTRACTS['AHT-11'].takes,unimplementedRequiredAssertions:adapters.CONTRACTS['AHT-11'].unimplementedRequiredAssertions,sourceAssertions:require('./source-control-crosswalk.json').controls.filter(row=>row.cases.includes('AHT-11'))};


module.exports.contract.requiredStartPressCap=adapters.CONTRACTS['AHT-11'].startPresses;

module.exports.contract.additionalSourceRequirements=Object.freeze({});

module.exports.requiresCaptureDevice=(caseConfig)=>adapters.requiresCaptureDevice('AHT-11',caseConfig);
