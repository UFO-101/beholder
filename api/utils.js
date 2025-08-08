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
  if (zoom >= 9 && zoom <= 12) return 7;   // Show R7 hexagons from zoom 9-12
  if (zoom >= 13 && zoom <= 15) return 9;  // Show R9 hexagons from zoom 13-15
  if (zoom >= 16) return 13;               // R13 for individual points (though we don't have heat_r13 table)
  return 7; // Default fallback to R7
}