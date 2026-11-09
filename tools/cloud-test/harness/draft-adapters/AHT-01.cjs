'use strict';
const adapters=require('./source-adapters.cjs');
module.exports=(args)=>adapters.run('AHT-01',args);
module.exports.preflight=(caseConfig)=>adapters.configurationPreflight('AHT-01',caseConfig);
module.exports.contract={caseId:'AHT-01',sourceSha:adapters.SOURCE_SHA,requiredAssertions:adapters.CONTRACTS['AHT-01'].rows,requiredOracles:adapters.CONTRACTS['AHT-01'].oracles,requiredTakeCap:adapters.CONTRACTS['AHT-01'].takes,unimplementedRequiredAssertions:adapters.CONTRACTS['AHT-01'].unimplementedRequiredAssertions,sourceAssertions:require('./source-control-crosswalk.json').controls.filter(row=>row.cases.includes('AHT-01'))};


module.exports.contract.requiredStartPressCap=adapters.CONTRACTS['AHT-01'].startPresses;

module.exports.contract.additionalSourceRequirements=Object.freeze({sameTargetNumeric:require('./progress-numeric.cjs').SOURCE_SHA});

module.exports.requiresCaptureDevice=(caseConfig)=>adapters.requiresCaptureDevice('AHT-01',caseConfig);
