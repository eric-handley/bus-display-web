import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

// GTFS Realtime API endpoint (protobuf)
const TRIP_UPDATES_URL = 'https://bct.tmix.se/gtfs-realtime/tripupdates.pb?operatorIds=48';

// Maximum number of upcoming arrivals to show
const MAX_ARRIVALS = 8;

// Parse stops CSV into a map
// const STOPS = new Map();
// stopsCSV.split('\n').slice(1).forEach(line => {
//   const [stopId, stopName] = line.split(',');
//   if (stopId && stopName) {
//     STOPS.set(stopId, stopName);
//   }
// });

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
    return minutes === 0 ? 'Now' : `${minutes} min`;
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
 * Process GTFS realtime data and extract arrivals for multiple stops
 * @param {Object} gtfsData - GTFS realtime feed data
 * @param {string[]} requestedStopIds - Array of stop IDs to filter for
 * @returns {Object[]} Array of stop data with arrivals
 */
function processGTFSData(gtfsData, requestedStopIds) {
  const nowTimestamp = Math.floor(Date.now() / 1000);

  // Map to store arrivals per stop
  const stopArrivals = new Map();
  requestedStopIds.forEach(stopId => stopArrivals.set(stopId, []));

  // Process each trip update
  if (!gtfsData.entity) {
    return formatResults(stopArrivals, nowTimestamp);
  }

  // Track how many stops still need arrivals (for early exit)
  let stopsNeedingMore = requestedStopIds.length;

  for (const entity of gtfsData.entity) {
    if (!entity.tripUpdate) continue;

    const tripUpdate = entity.tripUpdate;
    const rawRouteId = tripUpdate.trip?.routeId;

    if (!rawRouteId || !tripUpdate.stopTimeUpdate) continue;

    // Strip suffix once per trip (e.g., "28-VIC" -> "28")
    const routeId = rawRouteId.split('-')[0];

    // Check each stop time update
    for (const stopUpdate of tripUpdate.stopTimeUpdate) {
      const stopId = stopUpdate.stopId;

      // Only process requested stops
      if (!stopArrivals.has(stopId)) continue;
      if (!stopUpdate.arrival?.time) continue;

      const arrivalTime = stopUpdate.arrival.time;

      // Only include future arrivals
      if (arrivalTime <= nowTimestamp) continue;

      const arrivals = stopArrivals.get(stopId);
      arrivals.push({
        routeId,
        arrivalTimestamp: arrivalTime,
        deviation: stopUpdate.arrival.delay || 0
      });

      // Check if this stop has enough arrivals (3x buffer before sorting)
      if (arrivals.length === MAX_ARRIVALS * 3) {
        stopsNeedingMore--;
        if (stopsNeedingMore === 0) break;
      }
    }

    // Early exit if all stops have plenty of arrivals
    if (stopsNeedingMore === 0) break;
  }

  return formatResults(stopArrivals, nowTimestamp);
}

/**
 * Format and sort arrivals for each stop
 * @param {Map} stopArrivals - Map of stop IDs to arrival arrays
 * @param {number} nowTimestamp - Current timestamp
 * @returns {Object[]} Array of formatted stop results
 */
function formatResults(stopArrivals, nowTimestamp) {
  const results = [];

  for (const [stopId, arrivals] of stopArrivals) {
    // Sort by arrival time
    arrivals.sort((a, b) => a.arrivalTimestamp - b.arrivalTimestamp);

    // Format only the final limited results
    const limitedArrivals = arrivals.slice(0, MAX_ARRIVALS).map(a => ({
      routeId: a.routeId,
      arriving: formatArrivalTime(a.arrivalTimestamp, nowTimestamp),
      deviation: a.deviation
    }));

    results.push({
      stopId,
      arrivals: limitedArrivals
    });
  }

  return results;
}

export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);

      // Only accept POST requests to root path
      if (request.method !== 'POST' || url.pathname !== '/') {
        return new Response(
          JSON.stringify({
            error: 'Invalid request',
            message: 'Send a POST request to / with a JSON body containing stopIds',
            example: {
              stopIds: ['101028', '101039', '100998', '100988']
            }
          }, null, 2),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      // Parse request body
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(
          JSON.stringify({
            error: 'Invalid JSON',
            message: 'Request body must be valid JSON'
          }, null, 2),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      // Validate stopIds
      if (!body.stopIds || !Array.isArray(body.stopIds) || body.stopIds.length === 0) {
        return new Response(
          JSON.stringify({
            error: 'Invalid stopIds',
            message: 'Request body must contain a non-empty array of stopIds',
            example: {
              stopIds: ['101028', '101039']
            }
          }, null, 2),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      // Convert all stop IDs to strings
      const stopIds = body.stopIds.map(id => String(id));

      // Fetch GTFS realtime trip updates (protobuf) - only once for all stops
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

      // Parse the protobuf response
      const buffer = await response.arrayBuffer();
      const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
        new Uint8Array(buffer)
      );
      const gtfsData = { entity: feed.entity };

      // Process and format the data for all requested stops
      const results = processGTFSData(gtfsData, stopIds);

      // Return formatted response
      return new Response(
        JSON.stringify(results, null, 2),
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