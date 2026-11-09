'use strict';
const adapters=require('./source-adapters.cjs');
module.exports=(args)=>adapters.run('AHT-09',args);
module.exports.preflight=(caseConfig)=>adapters.configurationPreflight('AHT-09',caseConfig);
module.exports.contract={caseId:'AHT-09',sourceSha:adapters.SOURCE_SHA,requiredAssertions:adapters.CONTRACTS['AHT-09'].rows,requiredOracles:adapters.CONTRACTS['AHT-09'].oracles,requiredTakeCap:adapters.CONTRACTS['AHT-09'].takes,unimplementedRequiredAssertions:adapters.CONTRACTS['AHT-09'].unimplementedRequiredAssertions,sourceAssertions:require('./source-control-crosswalk.json').controls.filter(row=>row.cases.includes('AHT-09'))};


module.exports.contract.requiredStartPressCap=adapters.CONTRACTS['AHT-09'].startPresses;

module.exports.contract.additionalSourceRequirements=Object.freeze({});

module.exports.requiresCaptureDevice=(caseConfig)=>adapters.requiresCaptureDevice('AHT-09',caseConfig);
