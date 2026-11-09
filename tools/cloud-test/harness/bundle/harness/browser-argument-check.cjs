#!/usr/bin/env node
'use strict';
// Wrapper calls this before any profile ownership or executable launch. Never logs environment.
try{require('./launch-boundary.cjs').validateBrowserArguments(process.argv.slice(2),process.env);}
catch(e){console.error('chrome-wrapper: refused invocation: '+e.message);process.exitCode=64;}
