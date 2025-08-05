/**
 * Utility functions for the Cloudflare Worker
 */

// CORS headers
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Helper function to add CORS headers
export function corsResponse(response) {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

// Helper function to get H3 resolution based on zoom level
export function getH3Resolution(zoom) {
  if (zoom < 11) return 7;   // Low zoom: use R7 (~1.4km hexagons)
  if (zoom < 15) return 9;   // Medium zoom: use R9 (~200m hexagons)
  return 13;                 // High zoom: use R13 (~3m hexagons) for individual points
}