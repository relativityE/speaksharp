'use strict';
module.exports = async ({ context }) => { const p = await context.newPage(); const r = await p.goto('https://a.test/page'); if (r.status() !== 200) throw new Error('status ' + r.status()); };
