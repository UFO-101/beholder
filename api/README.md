# ⚡ Cloudflare Worker API

Modular serverless API for the London Beauty Heatmap with advanced Street View optimization and AI evaluation.

## 🎯 Features

- **Optimized Street View** (Method 2) with metadata + heading calculation
- **Gemini 2.5 Flash** AI aesthetic evaluation with robust parsing
- **Google Place ID** deduplication to prevent duplicates
- **H3 spatial indexing** for fast viewport queries
- **Modular ES6 architecture** for maintainability

## 📁 Modular Structure

```
api/
├── worker.js           # Main entry point with route handling
├── streetview.js       # Street View optimization (Method 2)
├── geocoding.js        # Google Maps Geocoding API
├── ai-evaluation.js    # Gemini 2.5 Flash evaluation
├── utils.js           # CORS, H3 resolution mapping
├── package.json       # Dependencies and ES module config
└── wrangler.toml      # Cloudflare Worker configuration
```

## 🚀 Deployment

```bash
# Install dependencies
npm install

# Configure secrets
wrangler secret put GEMINI_API_KEY
wrangler secret put GOOGLE_MAPS_API_KEY  
wrangler secret put DATABASE_URL

# Deploy to Cloudflare
wrangler deploy

# Local development
wrangler dev
```

## 📡 API Endpoints

### `POST /point`
Add new beauty rating with AI evaluation:
```json
{
  "address": "123 Baker Street, London",
  "imageUrl": "https://optional-image-url.jpg"
}
```

**Response:**
```json
{
  "success": true,
  "point": {
    "id": 123,
    "place_id": "ChIJ...",
    "lat": 51.5074,
    "lng": -0.1278,
    "beauty": 7.5,
    "description": "Well-maintained Victorian terrace...",
    "address": "123 Baker Street, London",
    "model_version": "gemini-2.5-flash"
  }
}
```

### `GET /heat?bbox=w,s,e,n&z=zoom`
Get aggregated heatmap data:
- **bbox**: `west,south,east,north` coordinates
- **z**: Zoom level (determines H3 resolution)

### `GET /points?bbox=w,s,e,n`
Get individual points for high zoom:
- Returns raw points with full details
- Used when zoom ≥ 15

### `GET /stats`
Overall statistics:
```json
{
  "total_points": 1250,
  "avg_beauty": 6.2,
  "min_beauty": 1.0,
  "max_beauty": 10.0
}
```

## 🔧 Module Details

### `streetview.js` - Advanced Street View
- **Metadata API** to find optimal panorama locations
- **Spherical trigonometry** for precise heading calculation
- **Coverage checking** before image generation
- **Method 2 optimization** matching Google Maps quality

### `ai-evaluation.js` - Gemini Integration  
- **Detailed prompts** with examples and scoring guidance
- **Enhanced parsing** with fallback number extraction
- **Score validation** and clamping (1-10 range)
- **Error handling** with detailed logging

### `geocoding.js` - Address Resolution
- **Google Place ID** extraction for deduplication
- **Location metadata** (type, formatted address)
- **Error handling** for invalid addresses

### `utils.js` - Shared Utilities
- **CORS handling** for web requests
- **H3 resolution mapping** based on zoom level
- **Response formatting** helpers

## 🗄️ Database Integration

Connects to Neon PostgreSQL with:
- **H3 spatial indexes** for fast queries
- **Place ID deduplication** via unique constraints  
- **Real-time aggregation** via database triggers
- **Optimized queries** for viewport-based data fetching

## 🔒 Security & Performance

- **Environment variables** for sensitive API keys
- **Input validation** for addresses and coordinates
- **Rate limiting** considerations for AI evaluation
- **Error boundaries** with detailed logging
- **CORS policies** for web integration

## 🧪 Testing

```bash
# Test API endpoints
curl https://your-worker.workers.dev/stats

# View logs
wrangler tail

# Local debugging
wrangler dev --local
```

Built for high-performance, serverless street beauty evaluation at global scale.