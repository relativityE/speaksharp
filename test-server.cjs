const http = require('http');

const options = {
  hostname: 'localhost',
  port: 5173,
  path: '/',
  method: 'GET'
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    if (data.includes('<div id="root">') || data.includes('script')) {
      console.log('✅ Server is serving content - blank screen likely fixed!');
    } else {
      console.log('❌ Server response seems empty');
    }
    console.log('Response length:', data.length);
  });
});

req.on('error', (e) => console.log('Error:', e.message));
req.end();
