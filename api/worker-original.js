/**
 * Cloudflare Worker for London Beauty Heatmap API
 * Handles geocoding, AI evaluation, and data storage
 */

import { Client } from '@neondatabase/serverless';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Helper function to add CORS headers
function corsResponse(response) {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

// Helper function to get H3 resolution based on zoom level
function getH3Resolution(zoom) {
  if (zoom < 11) return 7;
  if (zoom < 14) return 8;
  return 9;
}

// AI evaluation function using Gemini
async function evaluateAesthetics(imageUrl, address, env) {
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `You are an expert architectural and urban design critic evaluating the aesthetic quality of street scenes. 

Analyze this Street View image of ${address} and provide:

1. **Aesthetic Review** (2-3 sentences): Describe the architectural style, building condition, street environment, and overall visual appeal. Consider factors like:
   - Architectural quality and style
   - Road and pavement materials can make a surprising difference to the overall aesthetic. Brick or flagstone can greatly improve a street scene compared to concrete or asphalt.
   - Building maintenance and appearance
   - Street cleanliness and landscaping
   - Visual harmony and composition
   - Overall neighborhood character

2. **Beauty Score** (1-10): Rate the overall aesthetic appeal where:
   - 1-2: Bad (ugly, neglected, or visually jarring). Eg. industrial sites, derelict buildings
   - 3-4: Lackluster (bland, uninspiring). Eg. Grim housing blocks, dirty steets
   - 5-6: Okay (pleasant but unremarkable). Eg. Unadorned houses, bland modern developments
   - 7-8: Good (attractive, well-designed). Eg. Ornamented houses, greenery, flagstone paths
   - 9-10: Excellent (beautiful, exquisite) Eg. Ornate facades, colourful gardens, well composed street scenes

Be fair and open minded, while maintaining high standards. Don't be afraid to use the full range of the scale.

Format your response EXACTLY as:
REVIEW: [Your 2-3 sentence review here]
SCORE: [Single number from 1-10]

Example 1:
REVIEW: A well-maintained Victorian terrace with original period features and attractive brickwork. The street is clean with mature trees providing natural beauty, though some modern additions slightly detract from the historic character.
SCORE: 7

Example 2:
REVIEW: A bland residential block with integrated ground-level garages dominating the streetscape. While appearing adequately maintained, the design lacks visual interest and is devoid of notable aesthetic appeal or landscaping.
SCORE: 2`
              },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: imageUrl // This should be base64 encoded image data
                }
              }
            ]
          }
        ]
      })
    });

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Parse the response (enhanced version matching Python)
    let reviewMatch = text.match(/REVIEW:\s*(.+?)(?=SCORE:|$)/si);
    let scoreMatch = text.match(/SCORE:\s*(\d+(?:\.\d+)?)/i);
    
    let review = reviewMatch ? reviewMatch[1].trim() : null;
    let score = null;
    
    if (scoreMatch) {
      score = parseFloat(scoreMatch[1]);
      // Clamp score to 1-10 range
      score = Math.max(1.0, Math.min(10.0, score));
    }
    
    // If structured parsing fails, try to extract any number in 1-10 range
    if (score === null) {
      const numberMatches = text.match(/\b(\d+(?:\.\d+)?)\b/g);
      if (numberMatches) {
        for (const match of numberMatches) {
          const candidate = parseFloat(match);
          if (candidate >= 1.0 && candidate <= 10.0) {
            score = candidate;
            break;
          }
        }
      }
    }
    
    return {
      beauty: score,
      blurb: review,
      raw_response: text,
      parsing_successful: review !== null && score !== null
    };
  } catch (error) {
    console.error('AI evaluation failed:', error);
    return { beauty: null, blurb: null, error: error.message };
  }
}

// Geocoding function using Google Maps API
async function geocodeAddress(address, env) {
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

// Get Street View metadata including panorama location
async function getStreetViewMetadata(lat, lng, env) {
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
function calculateOptimalHeading(panoLat, panoLng, targetLat, targetLng) {
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
async function getOptimalStreetViewParams(targetLat, targetLng, env) {
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
async function getStreetViewImageUrl(lat, lng, env) {
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
async function hasStreetViewImagery(lat, lng, env) {
  const metadata = await getStreetViewMetadata(lat, lng, env);
  return metadata.available;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }));
    }

    try {
      // Initialize database connection
      const client = new Client(env.DATABASE_URL);
      await client.connect();

      // POST /point - Add a new point with AI evaluation
      if (request.method === 'POST' && url.pathname === '/point') {
        const { address, imageUrl, imageData, precomputedBeauty, precomputedReview } = await request.json();

        if (!address) {
          return corsResponse(new Response(
            JSON.stringify({ error: 'Address is required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          ));
        }

        // Geocode the address
        const geoResult = await geocodeAddress(address, env);
        if (!geoResult) {
          return corsResponse(new Response(
            JSON.stringify({ error: 'Failed to geocode address' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          ));
        }

        // Determine image source
        let imageForAI;
        let finalImageUrl;

        if (imageUrl) {
          // User provided image URL
          imageForAI = imageUrl;
          finalImageUrl = imageUrl;
        } else if (imageData) {
          // User provided base64 image data (from Python upload)
          imageForAI = imageData;
          finalImageUrl = 'uploaded_image';
        } else {
          // Auto-fetch optimized Street View image
          finalImageUrl = await getStreetViewImageUrl(geoResult.lat, geoResult.lng, env);
          if (!finalImageUrl) {
            return corsResponse(new Response(
              JSON.stringify({ error: 'No Street View imagery available for this address' }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            ));
          }
          
          imageForAI = finalImageUrl;
        }

        let aiResult;
        
        // Check if we have precomputed values (from upload script)
        if (precomputedBeauty && precomputedReview) {
          aiResult = {
            beauty: precomputedBeauty,
            blurb: precomputedReview
          };
        } else {
          // Evaluate with AI
          aiResult = await evaluateAesthetics(imageForAI, address, env);
          
          if (!aiResult.beauty) {
            return corsResponse(new Response(
              JSON.stringify({ error: 'Failed to evaluate aesthetics' }),
              { status: 500, headers: { 'Content-Type': 'application/json' } }
            ));
          }
        }

        // Check for existing place_id to avoid duplicates
        if (geoResult.place_id) {
          const existingQuery = `SELECT id, beauty, description, address, lat, lng FROM points WHERE place_id = $1`;
          const existingResult = await client.query(existingQuery, [geoResult.place_id]);
          
          if (existingResult.rows.length > 0) {
            const existing = existingResult.rows[0];
            return corsResponse(new Response(
              JSON.stringify({
                success: true,
                point: {
                  id: existing.id,
                  place_id: geoResult.place_id,
                  lat: existing.lat,
                  lng: existing.lng,
                  beauty: existing.beauty,
                  description: existing.description,
                  address: existing.address
                },
                message: 'Location already exists in database'
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            ));
          }
        }

        // Insert into database with new simplified schema
        const insertQuery = `
          INSERT INTO points (place_id, beauty, description, model_version, address, lat, lng)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, place_id, lat, lng, beauty, description, address, model_version, created_at
        `;

        const result = await client.query(insertQuery, [
          geoResult.place_id,
          aiResult.beauty,
          aiResult.blurb,
          'gemini-2.5-flash', // Model version
          geoResult.formatted_address,
          geoResult.lat,
          geoResult.lng
        ]);

        const newPoint = result.rows[0];

        // Broadcast to WebSocket clients (if implemented)
        // env.WEBSOCKET?.broadcast(JSON.stringify({
        //   type: 'new_point',
        //   data: newPoint
        // }));

        await client.end();

        return corsResponse(new Response(
          JSON.stringify({
            success: true,
            point: newPoint
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        ));
      }

      // GET /heat - Get aggregated heat data for heatmap
      if (request.method === 'GET' && url.pathname === '/heat') {
        const zoom = parseInt(url.searchParams.get('z')) || 12;
        const bbox = url.searchParams.get('bbox');
        
        if (!bbox) {
          return corsResponse(new Response(
            JSON.stringify({ error: 'bbox parameter is required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          ));
        }

        const [west, south, east, north] = bbox.split(',').map(Number);
        const resolution = getH3Resolution(zoom);
        
        // Query heat data for the bounding box
        const query = `
          SELECT 
            h3, 
            avg,
            h3_cell_to_latlng(h3) AS centroid
          FROM heat_r${resolution}
          WHERE h3 = ANY(
            SELECT h3_polyfill_estimate(
              ST_MakeEnvelope($1, $2, $3, $4, 4326), 
              ${resolution}
            )
          )
          AND avg IS NOT NULL
          LIMIT 10000
        `;

        const result = await client.query(query, [west, south, east, north]);
        
        const heatData = result.rows.map(row => ({
          lat: row.centroid.lat,
          lng: row.centroid.lng,
          avg: parseFloat(row.avg),
          h3: row.h3
        }));

        await client.end();

        return corsResponse(new Response(
          JSON.stringify(heatData),
          { headers: { 'Content-Type': 'application/json' } }
        ));
      }

      // GET /points - Get raw points for high zoom levels
      if (request.method === 'GET' && url.pathname === '/points') {
        const bbox = url.searchParams.get('bbox');
        
        if (!bbox) {
          return corsResponse(new Response(
            JSON.stringify({ error: 'bbox parameter is required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          ));
        }

        const [west, south, east, north] = bbox.split(',').map(Number);
        
        const query = `
          SELECT 
            id,
            place_id,
            lat,
            lng,
            beauty,
            description,
            address,
            model_version,
            h3_r13,
            created_at
          FROM points
          WHERE lat BETWEEN $2 AND $4
            AND lng BETWEEN $1 AND $3
          LIMIT 5000
        `;

        const result = await client.query(query, [west, south, east, north]);
        
        await client.end();

        return corsResponse(new Response(
          JSON.stringify(result.rows),
          { headers: { 'Content-Type': 'application/json' } }
        ));
      }

      // GET /stats - Get overall statistics
      if (request.method === 'GET' && url.pathname === '/stats') {
        const query = `
          SELECT 
            COUNT(*) as total_points,
            AVG(beauty) as avg_beauty,
            MIN(beauty) as min_beauty,
            MAX(beauty) as max_beauty,
            MIN(created_at) as first_point,
            MAX(created_at) as latest_point
          FROM points
        `;

        const result = await client.query(query);
        
        await client.end();

        return corsResponse(new Response(
          JSON.stringify(result.rows[0]),
          { headers: { 'Content-Type': 'application/json' } }
        ));
      }

      await client.end();
      return corsResponse(new Response('Not found', { status: 404 }));

    } catch (error) {
      console.error('Worker error:', error);
      return corsResponse(new Response(
        JSON.stringify({ error: 'Internal server error', details: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      ));
    }
  }
};