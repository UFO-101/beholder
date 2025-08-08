/**
 * Cloudflare Worker for London Beauty Heatmap API
 * Modular version with organized imports
 */

import { Client } from '@neondatabase/serverless';
import { geocodeAddress } from './geocoding.js';
import { getStreetViewImageUrl, hasStreetViewImagery } from './streetview.js';
import { evaluateAesthetics } from './ai-evaluation.js';
import { corsResponse, getH3Resolution } from './utils.js';

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
        
        // Simplified query - for now return all heat data (TODO: implement proper spatial filtering)
        const query = `
          SELECT 
            h3, 
            avg,
            h3_cell_to_lat_lng(h3) AS centroid
          FROM heat_r${resolution}
          WHERE avg IS NOT NULL
          LIMIT 10000
        `;

        const result = await client.query(query);
        
        const heatData = result.rows.map(row => ({
          lat: row.centroid.y,
          lng: row.centroid.x,
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

      // GET /maps-script - Get Google Maps script URL (keeps API key secure)
      if (request.method === 'GET' && url.pathname === '/maps-script') {
        const scriptUrl = `https://maps.googleapis.com/maps/api/js?key=${env.GOOGLE_MAPS_API_KEY}&libraries=geometry`;
        
        return corsResponse(new Response(
          JSON.stringify({ scriptUrl }),
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