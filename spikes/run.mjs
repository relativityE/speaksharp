import { chromium } from 'playwright-core';
const exe = process.env.PW_CHROMIUM;
const browser = await chromium.launch(exe ? {executablePath:exe, headless:true} : {headless:true});
const page = await browser.newPage();
const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
await page.goto('http://localhost:8791/index.html');
try{ await page.waitForFunction(()=>window.__r && window.__r.status!=='loading', {timeout:240000}); }catch(e){}
const r = await page.evaluate(()=>window.__r);
console.log('RESULT', JSON.stringify(r));
if(errs.length) console.log('CONSOLE_ERRORS', errs.slice(0,4).join(' || '));
await browser.close();
