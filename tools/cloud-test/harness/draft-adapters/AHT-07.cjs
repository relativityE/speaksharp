'use strict';
const adapters=require('./source-adapters.cjs');
module.exports=(args)=>adapters.run('AHT-07',args);
module.exports.preflight=(caseConfig)=>adapters.configurationPreflight('AHT-07',caseConfig);
module.exports.contract={caseId:'AHT-07',sourceSha:adapters.SOURCE_SHA,requiredAssertions:adapters.CONTRACTS['AHT-07'].rows,requiredOracles:adapters.CONTRACTS['AHT-07'].oracles,requiredTakeCap:adapters.CONTRACTS['AHT-07'].takes,unimplementedRequiredAssertions:adapters.CONTRACTS['AHT-07'].unimplementedRequiredAssertions,sourceAssertions:require('./source-control-crosswalk.json').controls.filter(row=>row.cases.includes('AHT-07'))};


// Two recordings are unchanged; three negative/retry feedback drafts plus final association draft are explicit.
module.exports.contract.requiredFeedbackAttemptCap=7;
module.exports.contract.requiredFeedbackNewReportCap=4;

module.exports.contract.requiredStartPressCap=adapters.CONTRACTS['AHT-07'].startPresses;

module.exports.contract.additionalSourceRequirements=Object.freeze({});

module.exports.requiresCaptureDevice=(caseConfig)=>adapters.requiresCaptureDevice('AHT-07',caseConfig);
