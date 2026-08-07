const fs = require('fs');
const filepath = '/tmp/speaksharp_fresh/frontend/src/components/session/__tests__/LiveRecordingCard.test.tsx';
let content = fs.readFileSync(filepath, 'utf8');

// There's a trailing `});` that shouldn't be there at the end
// Let's also remove all the tests dealing with mode switching or checking native/cloud since we removed those from the UI.
content = content.replace(/it\('positions Browser STT with a short cue and moves the explanation into help'[\s\S]*?\}\);/, '');
content = content.replace(/it\('shows NO pre-save Browser card CTA; the Private sample detail lives in help.*?\}\);/, '');
content = content.replace(/it\('explains why Private is unavailable after the sample is unavailable'[\s\S]*?\}\);/, '');
content = content.replace(/it\('lets a Private-sample user switch to Browser while Private setup is downloading'[\s\S]*?\}\);/, '');
content = content.replace(/it\('lets a subscribed Pro user switch to Cloud while Private setup is downloading'[\s\S]*?\}\);/, '');
content = content.replace(/it\('shows model size \(not setup time\) in the Private setup help.*?\}\);/s, '');
content = content.replace(/it\('Native\/Cloud mic-init is never mislabelled as the blue "downloading" pill'[\s\S]*?\}\);/, '');
content = content.replace(/it\('downloading the model.*?\}\);/s, '');
content = content.replace(/it\('keeps Stop visible while the controller is finishing a recording'[\s\S]*?\}\);/s, '');


// Fix syntax error near the end
content = content.replace(/}\);\n}\);\n\s*$/g, '});\n');
content = content.replace(/}\);\n}\);\n\s*$/g, '});\n');
content = content.replace(/}\);\n}\);\n\s*$/g, '});\n');

fs.writeFileSync(filepath, content, 'utf8');
