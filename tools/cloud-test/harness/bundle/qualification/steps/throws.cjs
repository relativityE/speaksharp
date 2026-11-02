'use strict';
module.exports = async ({ context }) => { const p = await context.newPage(); await p.goto('https://a.test/page'); throw new Error('step failure for test'); };
