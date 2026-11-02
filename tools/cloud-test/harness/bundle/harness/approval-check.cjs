#!/usr/bin/env node
'use strict';
const {assertSecurityApproval}=require('./approval-gate.cjs');
try {const file=process.argv[2];assertSecurityApproval({securityApprovalFile:file},{hosts:{}});}
catch(e){console.error(e.message);process.exitCode=78;}
