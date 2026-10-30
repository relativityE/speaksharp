'use strict';
const adapters=require('./source-adapters.cjs');
module.exports=(args)=>adapters.run('AHT-14',args);
module.exports.preflight=(caseConfig)=>adapters.configurationPreflight('AHT-14',caseConfig);
module.exports.contract={caseId:'AHT-14',sourceSha:adapters.SOURCE_SHA,requiredAssertions:adapters.CONTRACTS['AHT-14'].rows,requiredOracles:adapters.CONTRACTS['AHT-14'].oracles,requiredTakeCap:adapters.CONTRACTS['AHT-14'].takes,unimplementedRequiredAssertions:adapters.CONTRACTS['AHT-14'].unimplementedRequiredAssertions,sourceAssertions:require('./source-control-crosswalk.json').controls.filter(row=>row.cases.includes('AHT-14'))};


module.exports.contract.requiredStartPressCap=adapters.CONTRACTS['AHT-14'].startPresses;

module.exports.contract.additionalSourceRequirements=Object.freeze({});

module.exports.requiresCaptureDevice=(caseConfig)=>adapters.requiresCaptureDevice('AHT-14',caseConfig);
