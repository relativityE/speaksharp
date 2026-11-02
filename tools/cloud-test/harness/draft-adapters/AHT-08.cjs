'use strict';
const adapters=require('./source-adapters.cjs');
module.exports=(args)=>adapters.run('AHT-08',args);
module.exports.preflight=(caseConfig)=>adapters.configurationPreflight('AHT-08',caseConfig);
module.exports.contract={caseId:'AHT-08',sourceSha:adapters.SOURCE_SHA,requiredAssertions:adapters.CONTRACTS['AHT-08'].rows,requiredOracles:adapters.CONTRACTS['AHT-08'].oracles,requiredTakeCap:adapters.CONTRACTS['AHT-08'].takes,unimplementedRequiredAssertions:adapters.CONTRACTS['AHT-08'].unimplementedRequiredAssertions,sourceAssertions:require('./source-control-crosswalk.json').controls.filter(row=>row.cases.includes('AHT-08'))};


module.exports.contract.requiredStartPressCap=adapters.CONTRACTS['AHT-08'].startPresses;

module.exports.contract.additionalSourceRequirements=Object.freeze({});

module.exports.requiresCaptureDevice=(caseConfig)=>adapters.requiresCaptureDevice('AHT-08',caseConfig);
