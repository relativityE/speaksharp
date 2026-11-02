'use strict';
const adapters=require('./source-adapters.cjs');
module.exports=(args)=>adapters.run('AHT-13',args);
module.exports.preflight=(caseConfig)=>adapters.configurationPreflight('AHT-13',caseConfig);
module.exports.contract={caseId:'AHT-13',sourceSha:adapters.SOURCE_SHA,requiredAssertions:adapters.CONTRACTS['AHT-13'].rows,requiredOracles:adapters.CONTRACTS['AHT-13'].oracles,requiredTakeCap:adapters.CONTRACTS['AHT-13'].takes,unimplementedRequiredAssertions:adapters.CONTRACTS['AHT-13'].unimplementedRequiredAssertions,sourceAssertions:require('./source-control-crosswalk.json').controls.filter(row=>row.cases.includes('AHT-13'))};


module.exports.contract.requiredStartPressCap=adapters.CONTRACTS['AHT-13'].startPresses;

module.exports.contract.additionalSourceRequirements=Object.freeze({});

module.exports.requiresCaptureDevice=(caseConfig)=>adapters.requiresCaptureDevice('AHT-13',caseConfig);
