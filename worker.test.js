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
      expect(data).toHaveProperty('stopName');
      expect(data).toHaveProperty('routes');
      expect(data.routes).toBeInstanceOf(Array);
    }, API_TIMEOUT);

    it('should return route structure with required fields', async () => {
      const request = new Request('http://localhost:8787/stop/101028');
      const response = await worker.fetch(request);
      const data = await response.json();

      if (data.routes.length > 0) {
        const route = data.routes[0];
        expect(route).toHaveProperty('routeId');
        expect(route).toHaveProperty('buses');
        expect(route.buses).toBeInstanceOf(Array);

        if (route.buses.length > 0) {
          const bus = route.buses[0];
          expect(bus).toHaveProperty('arriving');
          expect(bus).toHaveProperty('delayed_by');

          // Should NOT have these fields
          expect(bus).not.toHaveProperty('tripId');
          expect(bus).not.toHaveProperty('headsign');
          expect(bus).not.toHaveProperty('vehicleId');
          expect(bus).not.toHaveProperty('arrivalTimestamp');
        }
      }
    }, API_TIMEOUT);

    it('should strip -VIC suffix from route IDs', async () => {
      const request = new Request('http://localhost:8787/stop/101028');
      const response = await worker.fetch(request);
      const data = await response.json();

      if (data.routes.length > 0) {
        data.routes.forEach(route => {
          expect(route.routeId).not.toContain('-VIC');
          expect(route.routeId).not.toContain('-');
        });
      }
    }, API_TIMEOUT);

    it('should limit buses per route to 5', async () => {
      const request = new Request('http://localhost:8787/stop/101028');
      const response = await worker.fetch(request);
      const data = await response.json();

      if (data.routes.length > 0) {
        data.routes.forEach(route => {
          expect(route.buses.length).toBeLessThanOrEqual(5);
        });
      }
    }, API_TIMEOUT);
  });

  describe('Time formatting', () => {
    it('should format arrival times correctly', async () => {
      const request = new Request('http://localhost:8787/stop/101028');
      const response = await worker.fetch(request);
      const data = await response.json();

      if (data.routes.length > 0) {
        data.routes.forEach(route => {
          route.buses.forEach(bus => {
            const arriving = bus.arriving;

            // Should be either "Now", "X min", or "H:MM am/pm" format
            const isNow = arriving === 'Now';
            const isMinutes = /^\d+ min$/.test(arriving);
            const isTime = /^\d{1,2}:\d{2} (am|pm)$/.test(arriving);

            expect(isNow || isMinutes || isTime).toBe(true);
          });
        });
      }
    }, API_TIMEOUT);

    it('should return "Now" for 0 min arrivals', async () => {
      const request = new Request('http://localhost:8787/stop/101028');
      const response = await worker.fetch(request);
      const data = await response.json();

      if (data.routes.length > 0) {
        data.routes.forEach(route => {
          route.buses.forEach(bus => {
            // Should never be "0 min", should be "Now" instead
            expect(bus.arriving).not.toBe('0 min');
          });
        });
      }
    }, API_TIMEOUT);
  });

  describe('Delay information', () => {
    it('should include delay information in seconds', async () => {
      const request = new Request('http://localhost:8787/stop/101028');
      const response = await worker.fetch(request);
      const data = await response.json();

      if (data.routes.length > 0 && data.routes[0].buses.length > 0) {
        data.routes.forEach(route => {
          route.buses.forEach(bus => {
            expect(typeof bus.delayed_by).toBe('number');
          });
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
      expect(data.routes).toEqual([]);
    }, API_TIMEOUT);
  });
});
