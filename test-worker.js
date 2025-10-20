// Test script to verify worker logic
import worker from './worker.js';

// Test without proper path (should return error)
console.log('Testing without proper path...\n');
const noPathRequest = new Request('http://localhost:8787/');

worker.fetch(noPathRequest)
  .then(response => response.json())
  .then(data => {
    console.log('Response (invalid path):');
    console.log(JSON.stringify(data, null, 2));
    console.log('\n---\n');
  })
  .then(() => {
    // Test with valid stop path
    console.log('Testing /stop/101028...\n');
    const validRequest = new Request('http://localhost:8787/stop/101028');

    return worker.fetch(validRequest)
      .then(response => response.json())
      .then(data => {
        console.log('Response (/stop/101028):');
        console.log(JSON.stringify(data, null, 2));
        console.log('\nTest completed successfully!');
      });
  })
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
