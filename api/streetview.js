/**
 * Street View API functions - optimized approach (Method 2)
 */

// Get Street View metadata including panorama location
export async function getStreetViewMetadata(lat, lng, env) {
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${env.GOOGLE_MAPS_API_KEY}`
    );
    const data = await response.json();
    
    if (data.status === 'OK') {
      return {
        available: true,
        pano_lat: data.location.lat,
        pano_lng: data.location.lng,
        pano_id: data.pano_id
      };
    }
    return { available: false };
  } catch (error) {
    console.error('Street View metadata check failed:', error);
    return { available: false };
  }
}

// Calculate optimal heading from panorama to target (like Google Maps does)
export function calculateOptimalHeading(panoLat, panoLng, targetLat, targetLng) {
  // Convert to radians
  const lat1 = panoLat * Math.PI / 180;
  const lat2 = targetLat * Math.PI / 180;
  const deltaLng = (targetLng - panoLng) * Math.PI / 180;
  
  // Calculate bearing using spherical law of cosines
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  
  let heading = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return Math.round(heading);
}

// Get optimal Street View parameters (Method 2 - Advanced)
export async function getOptimalStreetViewParams(targetLat, targetLng, env) {
  const metadata = await getStreetViewMetadata(targetLat, targetLng, env);
  
  if (!metadata.available) {
    return null;
  }
  
  // Calculate optimal heading from panorama location to target
  const heading = calculateOptimalHeading(
    metadata.pano_lat, 
    metadata.pano_lng, 
    targetLat, 
    targetLng
  );
  
  return {
    pano_lat: metadata.pano_lat,
    pano_lng: metadata.pano_lng,
    heading: heading,
    pano_id: metadata.pano_id
  };
}

// Get optimized Street View image URL (Method 2)
export async function getStreetViewImageUrl(lat, lng, env) {
  const optimalParams = await getOptimalStreetViewParams(lat, lng, env);
  
  if (!optimalParams) {
    return null; // No Street View coverage
  }
  
  const params = new URLSearchParams({
    size: '640x640',
    fov: '90',
    location: `${optimalParams.pano_lat},${optimalParams.pano_lng}`,
    heading: optimalParams.heading.toString(),
    source: 'outdoor', // Prefer official Street View over user photospheres
    key: env.GOOGLE_MAPS_API_KEY
  });
  
  return `https://maps.googleapis.com/maps/api/streetview?${params}`;
}

// Check if Street View imagery is available at location
export async function hasStreetViewImagery(lat, lng, env) {
  const metadata = await getStreetViewMetadata(lat, lng, env);
  return metadata.available;
}