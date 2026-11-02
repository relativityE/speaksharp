'use strict';
module.exports = async ({ context, log }) => { const p = await context.newPage(); await p.goto('https://a.test/page'); log('in-flight /hang'); await p.evaluate(() => fetch('/hang')).catch(() => {}); await new Promise(() => {}); };
