// Test script to verify worker logic
import worker from './worker.js';

// Create a mock request
const mockRequest = new Request('http://localhost:8787/');

// Test the worker
console.log('Testing bus arrivals API...\n');

worker.fetch(mockRequest, {}, {})
  .then(response => response.json())
  .then(data => {
    console.log('Response received:');
    console.log(JSON.stringify(data, null, 2));
    console.log('\nTest completed successfully!');
  })
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
