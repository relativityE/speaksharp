const fs = require('fs');
const filepath = '/tmp/speaksharp_fresh/frontend/src/components/session/__tests__/LiveRecordingCard.test.tsx';
let content = fs.readFileSync(filepath, 'utf8');

// Wipe the remainder from `it('returning user (post-session idle, model cached): the mic can start again WITHOUT a reload'`
// onwards completely and replace it with closing braces to fix all syntactic issues once and for all.
const splitPoint = "it('returning user (post-session idle, model cached): the mic can start again WITHOUT a reload', () => {";
if (content.includes(splitPoint)) {
    content = content.substring(0, content.indexOf(splitPoint));
    content += "});\n"; // Close the describe block
}

fs.writeFileSync(filepath, content, 'utf8');
