# 🌐 Frontend - Interactive Heatmap

Interactive web interface for visualizing London beauty data with zoom-adaptive layers.

## 🎯 Features

- **Real-time heatmap** with multi-resolution H3 aggregation
- **Individual point display** with building-level precision (H3-R13)
- **Add new locations** via address input with auto-Street View
- **Responsive design** optimized for desktop and mobile
- **Color-coded beauty scores** with legend

## 📁 Structure

```
frontend/
├── index.html    # Main HTML page with embedded styles
├── app.js        # Core application logic with deck.gl
└── utils.js      # Utility functions (if needed)
```

## 🚀 Deployment

### Local Development
```bash
# Serve static files
python -m http.server 8080
# or
npx serve .
```

### Cloudflare Pages
```bash
# Deploy directly
wrangler pages deploy . --project-name beauty-heatmap

# Or connect GitHub repo in Cloudflare dashboard
```

## 🔧 Configuration

Update `app.js` with your API keys:
```javascript
const CONFIG = {
    GOOGLE_MAPS_API_KEY: 'your_key_here',
    API_BASE_URL: '/api', // Will proxy to your Worker
    // ...
};
```

## 🗺️ Visualization Logic

### Zoom-Adaptive Layers
- **Zoom < 15**: HeatmapLayer with H3-R8/R7 aggregation
- **Zoom ≥ 15**: ScatterplotLayer with individual H3-R13 points

### Beauty Score Colors
- **1-2**: Red (Bad)
- **3-4**: Orange (Lackluster) 
- **5-6**: Yellow (Okay)
- **7-8**: Light Green (Good)
- **9-10**: Green (Excellent)

## 🎮 User Interaction

### Adding Points
1. Enter London address in input field
2. Optionally provide Street View image URL
3. System auto-fetches optimized Street View if no URL provided
4. AI evaluates aesthetic quality
5. Point appears on map with color-coded beauty score

### Viewing Data
- **Click points** to see detailed reviews and images
- **Pan/zoom** to explore different areas
- **Toggle layers** to show/hide heatmap vs individual points

## 📡 API Integration

Communicates with Cloudflare Worker API:
- `POST /point` - Add new beauty rating
- `GET /heat?bbox=...&z=...` - Get heatmap data
- `GET /points?bbox=...` - Get individual points
- `GET /stats` - Overall statistics

## 🎨 Technology Stack

- **Vanilla JavaScript** - No framework dependencies
- **deck.gl** - High-performance WebGL visualization
- **Google Maps API** - Base map and geocoding
- **Responsive CSS** - Mobile-optimized design