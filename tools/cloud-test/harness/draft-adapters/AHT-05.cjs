'use strict';
const adapters=require('./source-adapters.cjs');
module.exports=(args)=>adapters.run('AHT-05',args);
module.exports.preflight=(caseConfig)=>adapters.configurationPreflight('AHT-05',caseConfig);
module.exports.contract={caseId:'AHT-05',sourceSha:adapters.SOURCE_SHA,requiredAssertions:adapters.CONTRACTS['AHT-05'].rows,requiredOracles:adapters.CONTRACTS['AHT-05'].oracles,requiredTakeCap:adapters.CONTRACTS['AHT-05'].takes,unimplementedRequiredAssertions:adapters.CONTRACTS['AHT-05'].unimplementedRequiredAssertions,sourceAssertions:require('./source-control-crosswalk.json').controls.filter(row=>row.cases.includes('AHT-05'))};


module.exports.contract.requiredStartPressCap=adapters.CONTRACTS['AHT-05'].startPresses;

module.exports.contract.additionalSourceRequirements=Object.freeze({});

module.exports.requiresCaptureDevice=(caseConfig)=>adapters.requiresCaptureDevice('AHT-05',caseConfig);
