'use strict';
// Pure boundary policy plus local-file hashing. Never starts a process or changes trust/network state.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const FORBIDDEN_FLAGS=Object.freeze(['--no-sandbox','--no-zygote','--no-zygote-sandbox','--single-process','--disable-seccomp-filter-sandbox','--disable-namespace-sandbox','--in-process-gpu','--disable-gpu-sandbox','--allow-sandbox-debugging']);
const OVERRIDES=new Set(['--no-proxy-server','--proxy-auto-detect','--proxy-pac-url','--host-rules','--ignore-certificate-errors','--ignore-ssl-errors','--allow-insecure-localhost','--disable-web-security','--disable-setuid-sandbox','--enable-quic','--enable-webrtc-hide-local-ips-with-mdns']);
function guardFlags(port,spki){
 if(!Number.isInteger(port)||port<1||port>65535||typeof spki!=='string'||!/^[-A-Za-z0-9+/]{43}=$/.test(spki))throw new Error('invalid guard endpoint/key binding');
 return [`--proxy-server=http://127.0.0.1:${port}`,'--proxy-bypass-list=<-loopback>','--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',`--ignore-certificate-errors-spki-list=${spki}`,'--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--disable-background-networking','--disable-component-update','--disable-domain-reliability','--disable-sync','--deny-permission-prompts'];
}
function canonicalAbsolute(value,name){if(typeof value!=='string'||!path.isAbsolute(value)||path.resolve(value)!==value||/[\0\r\n]/.test(value))throw new Error('invalid '+name);return value;}
function childEnvironment({node,bundleRoot,approvalFile,mode='guarded',port,spki,chromePath}){
 if(!['guarded','version-probe'].includes(mode))throw new Error('invalid browser invocation mode');
 // Deliberately no spread/copy of parent env: no accounts, proxy credentials, NODE_OPTIONS,
 // NODE_PATH, loader/preload, dynamic-linker injection or cloud credentials reach either child.
 const env={PATH:'/usr/bin:/bin',HOME:'/var/tmp/ss-harness/home',TMPDIR:'/tmp',LANG:'C.UTF-8',LC_ALL:'C.UTF-8',TZ:'UTC',SS_HARNESS_NODE:canonicalAbsolute(node,'node'),SS_HARNESS_BUNDLE_ROOT:canonicalAbsolute(bundleRoot,'bundle root'),SS_HARNESS_APPROVAL_FILE:canonicalAbsolute(approvalFile,'approval file'),SS_HARNESS_LAUNCH_MODE:mode};
 if(mode==='guarded'){guardFlags(port,spki);env.SS_HARNESS_GUARD_PORT=String(port);env.SS_HARNESS_GUARD_SPKI=spki;}
 if(chromePath)env.CHROME_PATH=canonicalAbsolute(chromePath,'Chrome wrapper');
 return Object.freeze(env);
}
function validateBrowserArguments(args,env){
 if(!Array.isArray(args)||args.some(x=>typeof x!=='string'||/[\0\r\n]/.test(x)))throw new Error('invalid browser arguments');
 if(env.SS_HARNESS_LAUNCH_MODE==='version-probe'){if(args.length!==1||args[0]!=='--version')throw new Error('version probe accepts only --version');return {mode:'version-probe'};}
 if(env.SS_HARNESS_LAUNCH_MODE!=='guarded')throw new Error('explicit guarded invocation required');
 if(args.includes('--'))throw new Error('browser switch terminator forbidden');
 if(args.some(a=>a.startsWith('-')&&!a.startsWith('--')))throw new Error('noncanonical single-dash browser switch forbidden');
 const expected=guardFlags(Number(env.SS_HARNESS_GUARD_PORT),env.SS_HARNESS_GUARD_SPKI),keys=new Map(expected.map(x=>[x.split('=')[0],x]));
 for(const a of args){const key=a.split('=')[0];if(FORBIDDEN_FLAGS.includes(key)||OVERRIDES.has(key))throw new Error('forbidden browser flag '+key);if(keys.has(key)&&a!==keys.get(key))throw new Error('guard flag value changed '+key);}
 for(const [key,value]of keys)if(args.filter(a=>a.split('=')[0]===key).length!==1||!args.includes(value))throw new Error('missing/duplicate guard flag '+key);
 return {mode:'guarded',protectedFlags:expected.length};
}
function strictPairs(argv,allowed,required=[]){const out={};if(argv.length%2)throw new Error('arguments must be explicit flag/value pairs');for(let i=0;i<argv.length;i+=2){const k=argv[i];if(!/^--[a-z][a-z0-9-]*$/.test(k)||!allowed.includes(k.slice(2)))throw new Error('unknown or forbidden argument '+k);if(Object.hasOwn(out,k.slice(2)))throw new Error('duplicate argument '+k);if(typeof argv[i+1]!=='string'||!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('missing argument value '+k);out[k.slice(2)]=argv[i+1];}for(const k of required)if(!out[k])throw new Error('missing --'+k);return out;}
function observeExecutable(file){const p=canonicalAbsolute(path.resolve(file),'Lighthouse CLI');const st=fs.lstatSync(p);if(st.isSymbolicLink()||!st.isFile()||fs.realpathSync(p)!==p)throw new Error('Lighthouse CLI must be canonical regular file');return {path:p,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')};}
function hashExecutable(file,expected){const actual=observeExecutable(file);if(!/^[a-f0-9]{64}$/.test(expected||'')||actual.sha256!==expected)throw new Error('Lighthouse CLI differs from reviewed observed hash');return actual;}

// Lighthouse's installed parser uses yargs-parser: quote VALUES, not the whole flag group.
function lighthouseChromeFlags(flags){return flags.map(flag=>{const i=flag.indexOf('=');if(i<0)return flag;const value=flag.slice(i+1);if(/["\\\r\n\0]/.test(value))throw new Error('unsafe Chrome flag serialization');return flag.slice(0,i+1)+'"'+value+'"';}).join(' ');}
module.exports={FORBIDDEN_FLAGS,guardFlags,childEnvironment,validateBrowserArguments,strictPairs,observeExecutable,hashExecutable,lighthouseChromeFlags};
