'use strict';
// Pure fixture-row interpreter. No fs/network/subprocesses/dependencies. The reviewed loader
// alone supplies the exact one-use, counted guarded GET capability and authoritative receipt.
exports.readback = async ({ request, operationDigest }) => {
  const response = await request();
  if (response.status !== 200) throw new Error('fixture readback status');
  const body = JSON.parse(response.bodyText);
  if (!Array.isArray(body.rows)) throw new Error('fixture durable rows missing');
  const rows = body.rows.filter(row => row.operationDigest === operationDigest);
  return { operationDigest, durableSaved: rows.length === 1 && rows[0].saved === true, savedRowCount: rows.length };
};
