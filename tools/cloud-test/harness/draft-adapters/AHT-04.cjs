'use strict';
const adapters=require('./source-adapters.cjs');
module.exports=(args)=>adapters.run('AHT-04',args);
module.exports.preflight=(caseConfig)=>adapters.configurationPreflight('AHT-04',caseConfig);
module.exports.contract={caseId:'AHT-04',sourceSha:adapters.SOURCE_SHA,requiredAssertions:adapters.CONTRACTS['AHT-04'].rows,requiredOracles:adapters.CONTRACTS['AHT-04'].oracles,requiredTakeCap:adapters.CONTRACTS['AHT-04'].takes,unimplementedRequiredAssertions:adapters.CONTRACTS['AHT-04'].unimplementedRequiredAssertions,sourceAssertions:require('./source-control-crosswalk.json').controls.filter(row=>row.cases.includes('AHT-04'))};


module.exports.contract.requiredStartPressCap=adapters.CONTRACTS['AHT-04'].startPresses;

module.exports.contract.additionalSourceRequirements=Object.freeze({});

module.exports.requiresCaptureDevice=(caseConfig)=>adapters.requiresCaptureDevice('AHT-04',caseConfig);
