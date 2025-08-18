/**
 * Cloudflare Worker for London Beauty Heatmap API
 * D1 version with H3 calculations in JavaScript
 */

import { geocodeAddress } from './geocoding.js';
import { getStreetViewImageUrl, hasStreetViewImagery } from './streetview.js';
import { evaluateAesthetics } from './ai-evaluation.js';
import { corsResponse, getH3Resolution } from './utils.js';
import { cellToLatLng, latLngToCell } from 'h3-js';

// Helper function to update heat aggregation tables
async function updateHeatAggregates(db, h3_r7, h3_r9, beauty) {
  // Update heat_r7 (district level)
  await db.prepare(`
    INSERT INTO heat_r7 (h3, sum, cnt) VALUES (?, ?, 1)
    ON CONFLICT(h3) DO UPDATE SET 
      sum = sum + excluded.sum,
      cnt = cnt + 1
  `).bind(h3_r7, beauty).run();

  // Update heat_r9 (neighborhood level)  
  await db.prepare(`
    INSERT INTO heat_r9 (h3, sum, cnt) VALUES (?, ?, 1)
    ON CONFLICT(h3) DO UPDATE SET 
      sum = sum + excluded.sum,
      cnt = cnt + 1
  `).bind(h3_r9, beauty).run();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }));
    }

    try {
      // D1 database is available as env.DB (configured in wrangler.toml)

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

        // If this place already exists, return it immediately (skip Street View + AI)
        if (geoResult.place_id) {
          const existingResult = await env.DB.prepare(
            'SELECT id, place_id, beauty, description, address, lat, lng, model_version, image_url FROM points WHERE place_id = ?'
          ).bind(geoResult.place_id).first();
          
          if (existingResult) {
            return corsResponse(new Response(
              JSON.stringify({
                success: true,
                point: existingResult,
                message: 'Location already exists in database'
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            ));
          }
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

        // Calculate H3 indices at different resolutions
        const h3_r7 = latLngToCell(geoResult.lat, geoResult.lng, 7);
        const h3_r9 = latLngToCell(geoResult.lat, geoResult.lng, 9);
        const h3_r13 = latLngToCell(geoResult.lat, geoResult.lng, 13);

        // Insert into points table
        const insertResult = await env.DB.prepare(`
          INSERT INTO points (place_id, beauty, description, model_version, address, lat, lng, h3_r7, h3_r9, h3_r13, image_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          geoResult.place_id,
          aiResult.beauty,
          aiResult.blurb,
          'gemini-2.5-flash',
          geoResult.formatted_address,
          geoResult.lat,
          geoResult.lng,
          h3_r7,
          h3_r9,
          h3_r13,
          finalImageUrl
        ).run();

        // Update heat aggregation tables
        await updateHeatAggregates(env.DB, h3_r7, h3_r9, aiResult.beauty);

        // Get the inserted point for response
        const newPoint = await env.DB.prepare(
          'SELECT id, place_id, lat, lng, beauty, description, address, model_version, created_at, image_url FROM points WHERE id = ?'
        ).bind(insertResult.meta.last_row_id).first();

        return corsResponse(new Response(
          JSON.stringify({
            success: true,
            point: newPoint
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        ));
      }

      // GET /heat - Get aggregated heat data for heatmap (viewport-filtered)
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

        // Fetch candidate hexes from D1, then filter in the Worker using h3-js
        const { results } = await env.DB.prepare(`
          SELECT h3, avg FROM heat_r${resolution}
          WHERE avg IS NOT NULL
          LIMIT 20000
        `).all();

        const heatData = [];
        for (const row of results) {
          const [lat, lng] = cellToLatLng(row.h3);
          if (lng >= west && lng <= east && lat >= south && lat <= north) {
            heatData.push({
              lat,
              lng,
              avg: parseFloat(row.avg),
              h3: row.h3
            });
          }
        }

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
        
        const { results } = await env.DB.prepare(`
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
            created_at,
            image_url
          FROM points
          WHERE lat BETWEEN ? AND ?
            AND lng BETWEEN ? AND ?
          LIMIT 5000
        `).bind(south, north, west, east).all();

        return corsResponse(new Response(
          JSON.stringify(results),
          { headers: { 'Content-Type': 'application/json' } }
        ));
      }

      // GET /maps-script - Get Google Maps script URL (keeps API key secure)
      if (request.method === 'GET' && url.pathname === '/maps-script') {
        const scriptUrl = `https://maps.googleapis.com/maps/api/js?key=${env.GOOGLE_MAPS_API_KEY}&libraries=places,geometry&region=GB`;
        
        return corsResponse(new Response(
          JSON.stringify({ scriptUrl }),
          { headers: { 'Content-Type': 'application/json' } }
        ));
      }

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