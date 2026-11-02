'use strict';
const adapters=require('./source-adapters.cjs');
module.exports=(args)=>adapters.run('AHT-02',args);
module.exports.preflight=(caseConfig)=>adapters.configurationPreflight('AHT-02',caseConfig);
module.exports.contract={caseId:'AHT-02',sourceSha:adapters.SOURCE_SHA,requiredAssertions:adapters.CONTRACTS['AHT-02'].rows,requiredOracles:adapters.CONTRACTS['AHT-02'].oracles,requiredTakeCap:adapters.CONTRACTS['AHT-02'].takes,unimplementedRequiredAssertions:adapters.CONTRACTS['AHT-02'].unimplementedRequiredAssertions,sourceAssertions:require('./source-control-crosswalk.json').controls.filter(row=>row.cases.includes('AHT-02'))};


module.exports.contract.requiredStartPressCap=adapters.CONTRACTS['AHT-02'].startPresses;

module.exports.contract.additionalSourceRequirements=Object.freeze({sameTargetNumeric:require('./progress-numeric.cjs').SOURCE_SHA});

module.exports.requiresCaptureDevice=(caseConfig)=>adapters.requiresCaptureDevice('AHT-02',caseConfig);
