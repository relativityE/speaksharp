#!/usr/bin/env node
'use strict';
// SAFE aggregate: built-in offline tests only. Never launches qualification/selftest.cjs.
const fs=require('node:fs'),path=require('node:path');const {spawnSync}=require('node:child_process');
const tests=fs.readdirSync(__dirname).filter(f=>f.endsWith('.test.cjs')).sort().map(f=>path.join(__dirname,f));
const qualifierContracts=path.join(__dirname,'../qualification/offline-contracts.test.cjs');if(fs.existsSync(qualifierContracts))tests.push(qualifierContracts);
const adapters=path.join(__dirname,'../../draft-adapters/tests');if(fs.existsSync(adapters))tests.push(...fs.readdirSync(adapters).filter(f=>f.endsWith('.test.cjs')).sort().map(f=>path.join(adapters,f)));
const r=spawnSync(process.execPath,['--test',...tests],{stdio:'inherit'});process.exitCode=r.status===0?0:1;
