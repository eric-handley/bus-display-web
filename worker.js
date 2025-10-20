// Stop IDs to monitor (from data/stops.csv)
const MONITORED_STOPS = {
  '101028': 'Shelbourne St at Blair Ave',
  '101039': 'Shelbourne St at Blair Ave'
};

// GTFS Realtime API endpoint
const TRIP_UPDATES_URL = 'https://bct.tmix.se/gtfs-realtime/tripupdates.js?operatorIds=48';

// Maximum number of upcoming buses to show per route
const MAX_BUSES_PER_ROUTE = 5;

/**
 * Format a Unix timestamp as arrival time string
 * @param {number} timestamp - Unix timestamp in seconds
 * @param {number} nowTimestamp - Current time Unix timestamp
 * @returns {string} Formatted time like "5 min" or "2:30 pm"
 */
function formatArrivalTime(timestamp, nowTimestamp) {
  const minutesUntilArrival = Math.floor((timestamp - nowTimestamp) / 60);

  // If less than 60 minutes, show relative time
  if (minutesUntilArrival < 60) {
    return `${Math.max(0, minutesUntilArrival)} min`;
  }

  // Otherwise show absolute time in PST/PDT
  const date = new Date(timestamp * 1000);
  const timeStr = date.toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  return timeStr.toLowerCase();
}

/**
 * Process GTFS realtime data and extract arrivals for monitored stops
 * @param {Object} gtfsData - GTFS realtime feed data
 * @returns {Array} Structured array of stops with routes and buses
 */
function processGTFSData(gtfsData) {
  const nowTimestamp = Math.floor(Date.now() / 1000);

  // Map to store arrivals grouped by stop -> route -> buses
  const stopMap = new Map();

  // Initialize map for each monitored stop
  Object.keys(MONITORED_STOPS).forEach(stopId => {
    stopMap.set(stopId, new Map());
  });

  // Process each trip update
  if (!gtfsData.entity) {
    return [];
  }

  gtfsData.entity.forEach(entity => {
    if (!entity.trip_update) return;

    const tripUpdate = entity.trip_update;
    const routeId = tripUpdate.trip?.route_id;

    if (!routeId || !tripUpdate.stop_time_update) return;

    // Check each stop time update
    tripUpdate.stop_time_update.forEach(stopUpdate => {
      const stopId = stopUpdate.stop_id;

      // Only process monitored stops
      if (!MONITORED_STOPS[stopId]) return;
      if (!stopUpdate.arrival?.timeSpecified) return;

      const arrivalTime = stopUpdate.arrival.time;
      const delay = stopUpdate.arrival.delaySpecified ? stopUpdate.arrival.delay : 0;

      // Only include future arrivals
      if (arrivalTime <= nowTimestamp) return;

      // Get or create route entry for this stop
      const routeMap = stopMap.get(stopId);
      if (!routeMap.has(routeId)) {
        routeMap.set(routeId, []);
      }

      // Add bus arrival info
      routeMap.get(routeId).push({
        arriving: formatArrivalTime(arrivalTime, nowTimestamp),
        arrivalTimestamp: arrivalTime, // For sorting
        delayed_by: delay
      });
    });
  });

  // Convert map structure to array format
  const result = [];

  stopMap.forEach((routeMap, stopId) => {
    const routes = [];

    routeMap.forEach((buses, routeId) => {
      // Sort buses by arrival time
      buses.sort((a, b) => a.arrivalTimestamp - b.arrivalTimestamp);

      // Limit to MAX_BUSES_PER_ROUTE
      const limitedBuses = buses.slice(0, MAX_BUSES_PER_ROUTE);

      // Remove temporary sorting field
      limitedBuses.forEach(bus => delete bus.arrivalTimestamp);

      routes.push({
        routeId,
        buses: limitedBuses
      });
    });

    // Only include stops that have arrivals
    if (routes.length > 0) {
      result.push({
        stopId,
        stopName: MONITORED_STOPS[stopId],
        routes
      });
    }
  });

  return result;
}

export default {
  async fetch(request) {
    try {
      // Parse URL to get query parameters
      const url = new URL(request.url);
      const stopId = url.searchParams.get('stopId');

      // Require stopId parameter
      if (!stopId) {
        return new Response(
          JSON.stringify({
            error: 'Missing required parameter',
            message: 'Please provide a stopId query parameter',
            usage: `${url.origin}/?stopId=101028`,
            availableStops: Object.keys(MONITORED_STOPS).map(id => ({
              stopId: id,
              stopName: MONITORED_STOPS[id]
            }))
          }, null, 2),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      // Validate stopId
      if (!MONITORED_STOPS[stopId]) {
        return new Response(
          JSON.stringify({
            error: 'Invalid stopId',
            message: `Stop ${stopId} is not monitored`,
            availableStops: Object.keys(MONITORED_STOPS).map(id => ({
              stopId: id,
              stopName: MONITORED_STOPS[id]
            }))
          }, null, 2),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      // Fetch GTFS realtime trip updates
      const response = await fetch(TRIP_UPDATES_URL);

      if (!response.ok) {
        return new Response(
          JSON.stringify({ error: 'Failed to fetch transit data' }),
          {
            status: 502,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      // Parse the JSON response
      const gtfsData = await response.json();

      // Process and format the data
      const allResults = processGTFSData(gtfsData);

      // Filter for requested stop
      const result = allResults.find(stop => stop.stopId === stopId);

      if (!result) {
        return new Response(
          JSON.stringify({
            stopId,
            stopName: MONITORED_STOPS[stopId],
            routes: []
          }, null, 2),
          {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=30'
            }
          }
        );
      }

      // Return formatted response
      return new Response(
        JSON.stringify(result, null, 2),
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=30' // Cache for 30 seconds
          }
        }
      );

    } catch (error) {
      console.error('Error processing request:', error);
      return new Response(
        JSON.stringify({ error: 'Internal server error', message: error.message }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  }
};