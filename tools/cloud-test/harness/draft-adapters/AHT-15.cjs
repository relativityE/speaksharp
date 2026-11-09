'use strict';
const adapters=require('./source-adapters.cjs');
module.exports=(args)=>adapters.run('AHT-15',args);
module.exports.preflight=(caseConfig)=>adapters.configurationPreflight('AHT-15',caseConfig);
module.exports.contract={caseId:'AHT-15',sourceSha:adapters.SOURCE_SHA,requiredAssertions:adapters.CONTRACTS['AHT-15'].rows,requiredOracles:adapters.CONTRACTS['AHT-15'].oracles,requiredTakeCap:adapters.CONTRACTS['AHT-15'].takes,unimplementedRequiredAssertions:adapters.CONTRACTS['AHT-15'].unimplementedRequiredAssertions,sourceAssertions:require('./source-control-crosswalk.json').controls.filter(row=>row.cases.includes('AHT-15'))};


module.exports.contract.requiredStartPressCap=adapters.CONTRACTS['AHT-15'].startPresses;

module.exports.contract.additionalSourceRequirements=Object.freeze({});

module.exports.requiresCaptureDevice=(caseConfig)=>adapters.requiresCaptureDevice('AHT-15',caseConfig);
