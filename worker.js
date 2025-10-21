import stopsCSV from './data/stops.csv';

// GTFS Realtime API endpoint
const TRIP_UPDATES_URL = 'https://bct.tmix.se/gtfs-realtime/tripupdates.js?operatorIds=48';

// Maximum number of upcoming arrivals to show
const MAX_ARRIVALS = 8;

// Parse stops CSV into a map
const STOPS = new Map();
stopsCSV.split('\n').slice(1).forEach(line => {
  const [stopId, stopName] = line.split(',');
  if (stopId && stopName) {
    STOPS.set(stopId, stopName);
  }
});

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
    const minutes = Math.max(0, minutesUntilArrival);
return minutes === 0 ? 'Now' : `${minutes} m`;
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
 * Process GTFS realtime data and extract arrivals for a specific stop
 * @param {Object} gtfsData - GTFS realtime feed data
 * @param {string} requestedStopId - The stop ID to filter for
 * @returns {Object|null} Stop data with arrivals, or null if no arrivals
 */
function processGTFSData(gtfsData, requestedStopId) {
  const nowTimestamp = Math.floor(Date.now() / 1000);

  // Array to store all arrivals
  const arrivals = [];

  // Process each trip update
  if (!gtfsData.entity) {
    return null;
  }

  gtfsData.entity.forEach(entity => {
    if (!entity.trip_update) return;

    const tripUpdate = entity.trip_update;
    const rawRouteId = tripUpdate.trip?.route_id;

    if (!rawRouteId || !tripUpdate.stop_time_update) return;

    // Strip suffix (e.g., "28-VIC" -> "28")
    const routeId = rawRouteId.split('-')[0];

    // Check each stop time update
    tripUpdate.stop_time_update.forEach(stopUpdate => {
      const stopId = stopUpdate.stop_id;

      // Only process the requested stop
      if (stopId !== requestedStopId) return;
      if (!stopUpdate.arrival?.timeSpecified) return;

      const arrivalTime = stopUpdate.arrival.time;
      const delay = stopUpdate.arrival.delaySpecified ? stopUpdate.arrival.delay : 0;

      // Only include future arrivals
      if (arrivalTime <= nowTimestamp) return;

      // Add arrival info
      arrivals.push({
        routeId,
        arriving: formatArrivalTime(arrivalTime, nowTimestamp),
        arrivalTimestamp: arrivalTime, // For sorting
        deviation: delay
      });
    });
  });

  // Return null if no arrivals found
  if (arrivals.length === 0) {
    return null;
  }

  // Sort all arrivals by time
  arrivals.sort((a, b) => a.arrivalTimestamp - b.arrivalTimestamp);

  // Limit to MAX_ARRIVALS and remove temporary sorting field
  const limitedArrivals = arrivals.slice(0, MAX_ARRIVALS);
  limitedArrivals.forEach(arrival => delete arrival.arrivalTimestamp);

  return {
    stopId: requestedStopId,
    stopName: STOPS.get(requestedStopId) || `Stop ${requestedStopId}`,
    arrivals: limitedArrivals
  };
}

export default {
  async fetch(request) {
    try {
      // Parse URL to get path
      const url = new URL(request.url);
      const pathMatch = url.pathname.match(/^\/stop\/(\d+)$/);

      // Require /stop/{id} format
      if (!pathMatch) {
        return new Response(
          JSON.stringify({
            error: 'Invalid route',
            message: 'Please use the format /stop/{stopId}',
            usage: `${url.origin}/stop/100000`
          }, null, 2),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      const stopId = pathMatch[1];

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

      // Process and format the data for the requested stop
      const result = processGTFSData(gtfsData, stopId);

      // Return empty arrivals if no arrivals found
      if (!result) {
        return new Response(
          JSON.stringify({
            stopId,
            stopName: STOPS.get(stopId) || `Stop ${stopId}`,
            arrivals: []
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