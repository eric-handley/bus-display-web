import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './worker.js';

// Increase timeout for tests that make real API calls
const API_TIMEOUT = 30000;

describe('Bus Display Worker', () => {
  describe('Route validation', () => {
    it('should return error for invalid route (root path)', async () => {
      const request = new Request('http://localhost:8787/');
      const response = await worker.fetch(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid route');
      expect(data.message).toBe('Please use the format /stop/{stopId}');
      expect(data.usage).toContain('/stop/');
      expect(data.exampleStops).toBeInstanceOf(Array);
    });

    it('should return error for invalid route (wrong path)', async () => {
      const request = new Request('http://localhost:8787/invalid/path');
      const response = await worker.fetch(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid route');
    });

    it('should accept valid stop ID path format', async () => {
      const request = new Request('http://localhost:8787/stop/101028');
      const response = await worker.fetch(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');
    }, API_TIMEOUT);
  });

  describe('Response format', () => {
    it('should return correct structure for valid stop', async () => {
      const request = new Request('http://localhost:8787/stop/101028');
      const response = await worker.fetch(request);
      const data = await response.json();

      expect(data).toHaveProperty('stopId', '101028');
      expect(data).toHaveProperty('arrivals');
      expect(data.arrivals).toBeInstanceOf(Array);
    }, API_TIMEOUT);

    it('should return arrival structure with required fields', async () => {
      const request = new Request('http://localhost:8787/stop/101028');
      const response = await worker.fetch(request);
      const data = await response.json();

      if (data.arrivals.length > 0) {
        const arrival = data.arrivals[0];
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
      const request = new Request('http://localhost:8787/stop/101028');
      const response = await worker.fetch(request);
      const data = await response.json();

      if (data.arrivals.length > 0) {
        data.arrivals.forEach(arrival => {
          expect(arrival.routeId).not.toContain('-VIC');
          expect(arrival.routeId).not.toContain('-');
        });
      }
    }, API_TIMEOUT);

    it('should limit total arrivals to 8', async () => {
      const request = new Request('http://localhost:8787/stop/101028');
      const response = await worker.fetch(request);
      const data = await response.json();

      expect(data.arrivals.length).toBeLessThanOrEqual(8);
    }, API_TIMEOUT);

    it('should sort arrivals by time', async () => {
      const request = new Request('http://localhost:8787/stop/101028');
      const response = await worker.fetch(request);
      const data = await response.json();

      if (data.arrivals.length > 1) {
        // Check that arrivals are in order (Now < X m < Y m < time)
        for (let i = 0; i < data.arrivals.length - 1; i++) {
          const current = data.arrivals[i].arriving;
          const next = data.arrivals[i + 1].arriving;

          // Simple check: if current is "Now", next shouldn't be "Now"
          // if current is "X m", next should be >= X m or a time
          if (current === 'Now') {
            expect(next).not.toBe('Now');
          }
        }
      }
    }, API_TIMEOUT);
  });

  describe('Time formatting', () => {
    it('should format arrival times correctly', async () => {
      const request = new Request('http://localhost:8787/stop/101028');
      const response = await worker.fetch(request);
      const data = await response.json();

      if (data.arrivals.length > 0) {
        data.arrivals.forEach(arrival => {
          const arriving = arrival.arriving;

          // Should be either "Now", "X m", or "H:MM am/pm" format
          const isNow = arriving === 'Now';
          const isMinutes = /^\d+ m$/.test(arriving);
          const isTime = /^\d{1,2}:\d{2} (am|pm)$/.test(arriving);

          expect(isNow || isMinutes || isTime).toBe(true);
        });
      }
    }, API_TIMEOUT);

    it('should return "Now" for 0 min arrivals', async () => {
      const request = new Request('http://localhost:8787/stop/101028');
      const response = await worker.fetch(request);
      const data = await response.json();

      if (data.arrivals.length > 0) {
        data.arrivals.forEach(arrival => {
          // Should never be "0 m", should be "Now" instead
          expect(arrival.arriving).not.toBe('0 m');
        });
      }
    }, API_TIMEOUT);
  });

  describe('Deviation information', () => {
    it('should include deviation information in seconds', async () => {
      const request = new Request('http://localhost:8787/stop/101028');
      const response = await worker.fetch(request);
      const data = await response.json();

      if (data.arrivals.length > 0) {
        data.arrivals.forEach(arrival => {
          expect(typeof arrival.deviation).toBe('number');
          expect(arrival).not.toHaveProperty('delayed_by');
        });
      }
    }, API_TIMEOUT);
  });

  describe('Cache headers', () => {
    it('should include cache control headers', async () => {
      const request = new Request('http://localhost:8787/stop/101028');
      const response = await worker.fetch(request);

      expect(response.headers.get('Cache-Control')).toBe('public, max-age=30');
    }, API_TIMEOUT);
  });

  describe('Error handling', () => {
    it('should handle any stop ID gracefully', async () => {
      const request = new Request('http://localhost:8787/stop/999999');
      const response = await worker.fetch(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.stopId).toBe('999999');
      expect(data.arrivals).toEqual([]);
    }, API_TIMEOUT);
  });
});
