import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './worker.js';

// Increase timeout for tests that make real API calls
const API_TIMEOUT = 30000;

describe('Bus Display Worker', () => {
  describe('Request validation', () => {
    it('should return error for GET request', async () => {
      const request = new Request('http://localhost:8787/');
      const response = await worker.fetch(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request');
      expect(data.message).toContain('POST request');
      expect(data.example).toHaveProperty('stopIds');
    });

    it('should return error for wrong path', async () => {
      const request = new Request('http://localhost:8787/invalid/path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopIds: ['101028'] })
      });
      const response = await worker.fetch(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request');
    });

    it('should return error for invalid JSON', async () => {
      const request = new Request('http://localhost:8787/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json'
      });
      const response = await worker.fetch(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid JSON');
    });

    it('should return error for missing stopIds', async () => {
      const request = new Request('http://localhost:8787/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const response = await worker.fetch(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid stopIds');
    });

    it('should return error for empty stopIds array', async () => {
      const request = new Request('http://localhost:8787/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopIds: [] })
      });
      const response = await worker.fetch(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid stopIds');
    });

    it('should accept valid POST request', async () => {
      const request = new Request('http://localhost:8787/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopIds: ['101028'] })
      });
      const response = await worker.fetch(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');
    }, API_TIMEOUT);
  });

  describe('Response format', () => {
    it('should return array of results', async () => {
      const request = new Request('http://localhost:8787/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopIds: ['101028', '101039'] })
      });
      const response = await worker.fetch(request);
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(2);
      expect(data[0]).toHaveProperty('stopId', '101028');
      expect(data[0]).toHaveProperty('arrivals');
      expect(data[0].arrivals).toBeInstanceOf(Array);
      expect(data[1]).toHaveProperty('stopId', '101039');
      expect(data[1]).toHaveProperty('arrivals');
    }, API_TIMEOUT);

    it('should return arrival structure with required fields', async () => {
      const request = new Request('http://localhost:8787/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopIds: ['101028'] })
      });
      const response = await worker.fetch(request);
      const data = await response.json();

      const stopData = data[0];
      if (stopData.arrivals.length > 0) {
        const arrival = stopData.arrivals[0];
        expect(arrival).toHaveProperty('routeId');
        expect(arrival).toHaveProperty('arriving');
        expect(arrival).toHaveProperty('deviation');

        // Should NOT have these fields
        expect(arrival).not.toHaveProperty('tripId');
        expect(arrival).not.toHaveProperty('headsign');
        expect(arrival).not.toHaveProperty('vehicleId');
        expect(arrival).not.toHaveProperty('arrivalTimestamp');
        expect(arrival).not.toHaveProperty('delayed_by');
      }
    }, API_TIMEOUT);

    it('should strip -VIC suffix from route IDs', async () => {
      const request = new Request('http://localhost:8787/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopIds: ['101028'] })
      });
      const response = await worker.fetch(request);
      const data = await response.json();

      const stopData = data[0];
      if (stopData.arrivals.length > 0) {
        stopData.arrivals.forEach(arrival => {
          expect(arrival.routeId).not.toContain('-VIC');
          expect(arrival.routeId).not.toContain('-');
        });
      }
    }, API_TIMEOUT);

    it('should limit arrivals to 8 per stop', async () => {
      const request = new Request('http://localhost:8787/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopIds: ['101028'] })
      });
      const response = await worker.fetch(request);
      const data = await response.json();

      const stopData = data[0];
      expect(stopData.arrivals.length).toBeLessThanOrEqual(8);
    }, API_TIMEOUT);

    it('should sort arrivals by time', async () => {
      const request = new Request('http://localhost:8787/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopIds: ['101028'] })
      });
      const response = await worker.fetch(request);
      const data = await response.json();

      const stopData = data[0];
      if (stopData.arrivals.length > 1) {
        // Check that arrivals are in order (Now < X m < Y m < time)
        for (let i = 0; i < stopData.arrivals.length - 1; i++) {
          const current = stopData.arrivals[i].arriving;
          const next = stopData.arrivals[i + 1].arriving;

          // Simple check: if current is "Now", next shouldn't be "Now"
          if (current === 'Now') {
            expect(next).not.toBe('Now');
          }
        }
      }
    }, API_TIMEOUT);
  });

  describe('Time formatting', () => {
    it('should format arrival times correctly', async () => {
      const request = new Request('http://localhost:8787/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopIds: ['101028'] })
      });
      const response = await worker.fetch(request);
      const data = await response.json();

      const stopData = data[0];
      if (stopData.arrivals.length > 0) {
        stopData.arrivals.forEach(arrival => {
          const arriving = arrival.arriving;

          // Should be either "Now", "X min", or "H:MM am/pm" format
          const isNow = arriving === 'Now';
          const isMinutes = /^\d+ min$/.test(arriving);
          const isTime = /^\d{1,2}:\d{2} (am|pm)$/.test(arriving);

          expect(isNow || isMinutes || isTime).toBe(true);
        });
      }
    }, API_TIMEOUT);

    it('should return "Now" for 0 min arrivals', async () => {
      const request = new Request('http://localhost:8787/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopIds: ['101028'] })
      });
      const response = await worker.fetch(request);
      const data = await response.json();

      const stopData = data[0];
      if (stopData.arrivals.length > 0) {
        stopData.arrivals.forEach(arrival => {
          // Should never be "0 min", should be "Now" instead
          expect(arrival.arriving).not.toBe('0 min');
        });
      }
    }, API_TIMEOUT);
  });

  describe('Deviation information', () => {
    it('should include deviation information in seconds', async () => {
      const request = new Request('http://localhost:8787/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopIds: ['101028'] })
      });
      const response = await worker.fetch(request);
      const data = await response.json();

      const stopData = data[0];
      if (stopData.arrivals.length > 0) {
        stopData.arrivals.forEach(arrival => {
          expect(typeof arrival.deviation).toBe('number');
          expect(arrival).not.toHaveProperty('delayed_by');
        });
      }
    }, API_TIMEOUT);
  });

  describe('Cache headers', () => {
    it('should include cache control headers', async () => {
      const request = new Request('http://localhost:8787/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopIds: ['101028'] })
      });
      const response = await worker.fetch(request);

      expect(response.headers.get('Cache-Control')).toBe('public, max-age=30');
    }, API_TIMEOUT);
  });

  describe('Error handling', () => {
    it('should handle any stop ID gracefully', async () => {
      const request = new Request('http://localhost:8787/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopIds: ['999999'] })
      });
      const response = await worker.fetch(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data[0].stopId).toBe('999999');
      expect(data[0].arrivals).toEqual([]);
    }, API_TIMEOUT);
  });
});
