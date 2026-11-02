'use strict';
const adapters=require('./source-adapters.cjs');
module.exports=(args)=>adapters.run('AHT-06',args);
module.exports.preflight=(caseConfig)=>adapters.configurationPreflight('AHT-06',caseConfig);
module.exports.contract={caseId:'AHT-06',sourceSha:adapters.SOURCE_SHA,requiredAssertions:adapters.CONTRACTS['AHT-06'].rows,requiredOracles:adapters.CONTRACTS['AHT-06'].oracles,requiredTakeCap:adapters.CONTRACTS['AHT-06'].takes,unimplementedRequiredAssertions:adapters.CONTRACTS['AHT-06'].unimplementedRequiredAssertions,sourceAssertions:require('./source-control-crosswalk.json').controls.filter(row=>row.cases.includes('AHT-06'))};


module.exports.contract.requiredStartPressCap=adapters.CONTRACTS['AHT-06'].startPresses;

module.exports.contract.additionalSourceRequirements=Object.freeze({});

module.exports.requiresCaptureDevice=(caseConfig)=>adapters.requiresCaptureDevice('AHT-06',caseConfig);
