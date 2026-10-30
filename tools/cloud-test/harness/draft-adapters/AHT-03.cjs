'use strict';
const adapters=require('./source-adapters.cjs');
module.exports=(args)=>adapters.run('AHT-03',args);
module.exports.preflight=(caseConfig)=>adapters.configurationPreflight('AHT-03',caseConfig);
module.exports.contract={caseId:'AHT-03',sourceSha:adapters.SOURCE_SHA,requiredAssertions:adapters.CONTRACTS['AHT-03'].rows,requiredOracles:adapters.CONTRACTS['AHT-03'].oracles,requiredTakeCap:adapters.CONTRACTS['AHT-03'].takes,unimplementedRequiredAssertions:adapters.CONTRACTS['AHT-03'].unimplementedRequiredAssertions,sourceAssertions:require('./source-control-crosswalk.json').controls.filter(row=>row.cases.includes('AHT-03'))};


module.exports.contract.requiredStartPressCap=adapters.CONTRACTS['AHT-03'].startPresses;

module.exports.contract.additionalSourceRequirements=Object.freeze({sameTargetNumeric:require('./progress-numeric.cjs').SOURCE_SHA});

module.exports.requiresCaptureDevice=(caseConfig)=>adapters.requiresCaptureDevice('AHT-03',caseConfig);
