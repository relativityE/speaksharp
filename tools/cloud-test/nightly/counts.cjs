"use strict";
// Nightly AHT suite: what counts as an observed count. A count the spec read is a whole number, zero or more. NaN, a
// negative number, a fraction, Infinity, a string or a missing value is not an observation: the oracle holds on it
// rather than comparing it (NaN > 0 and -1 > 0 are both false, so a plain comparison would read either as zero).
const isCount = (n) => Number.isInteger(n) && n >= 0;
/** Names the fields of `o` that are not counts. */
const notCounts = (o, fields) => fields.filter((f) => !isCount(o?.[f]));

module.exports = { isCount, notCounts };
