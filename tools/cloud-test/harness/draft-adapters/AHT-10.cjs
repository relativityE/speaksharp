'use strict';
const adapters=require('./source-adapters.cjs');
module.exports=(args)=>adapters.run('AHT-10',args);
module.exports.preflight=(caseConfig)=>adapters.configurationPreflight('AHT-10',caseConfig);
module.exports.contract={caseId:'AHT-10',sourceSha:adapters.SOURCE_SHA,requiredAssertions:adapters.CONTRACTS['AHT-10'].rows,requiredOracles:adapters.CONTRACTS['AHT-10'].oracles,requiredTakeCap:adapters.CONTRACTS['AHT-10'].takes,unimplementedRequiredAssertions:adapters.CONTRACTS['AHT-10'].unimplementedRequiredAssertions,sourceAssertions:require('./source-control-crosswalk.json').controls.filter(row=>row.cases.includes('AHT-10'))};


module.exports.contract.requiredStartPressCap=adapters.CONTRACTS['AHT-10'].startPresses;

module.exports.contract.additionalSourceRequirements=Object.freeze({});

module.exports.requiresCaptureDevice=(caseConfig)=>adapters.requiresCaptureDevice('AHT-10',caseConfig);
