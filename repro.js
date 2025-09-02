// repro.js
// import only what's needed by the hook to reproduce import-time allocations
import './src/hooks/useSpeechRecognition.js';
console.log('import succeeded');
