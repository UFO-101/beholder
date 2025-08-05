/**
 * Google Maps Geocoding API functions
 */

// Geocoding function using Google Maps API
export async function geocodeAddress(address, env) {
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${env.GOOGLE_MAPS_API_KEY}`
    );
    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
      const result = data.results[0];
      const location = result.geometry.location;
      return {
        lat: location.lat,
        lng: location.lng,
        formatted_address: result.formatted_address,
        place_id: result.place_id,
        location_type: result.geometry.location_type,
        types: result.types
      };
    }
    return null;
  } catch (error) {
    console.error('Geocoding failed:', error);
    return null;
  }
}