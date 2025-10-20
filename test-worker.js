// Test script to verify worker logic
import worker from './worker.js';

// Test without stopId parameter (should return error)
console.log('Testing without stopId parameter...\n');
const noParamRequest = new Request('http://localhost:8787/');

worker.fetch(noParamRequest)
  .then(response => response.json())
  .then(data => {
    console.log('Response (no stopId):');
    console.log(JSON.stringify(data, null, 2));
    console.log('\n---\n');
  })
  .then(() => {
    // Test with valid stopId
    console.log('Testing with stopId=101028...\n');
    const validRequest = new Request('http://localhost:8787/?stopId=101028');

    return worker.fetch(validRequest)
      .then(response => response.json())
      .then(data => {
        console.log('Response (stopId=101028):');
        console.log(JSON.stringify(data, null, 2));
        console.log('\nTest completed successfully!');
      });
  })
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
