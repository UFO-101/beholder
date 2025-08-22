# 🌍 Beholder - AI Beauty Explorer

An interactive global heatmap revealing the aesthetic beauty of any location through AI analysis of Street View imagery. Discover beautiful places worldwide through the eyes of artificial intelligence.

![Beholder Preview](https://beholder.fyi/cover-img-1200-630.png)

**🔗 Live Demo: [beholder.fyi](https://beholder.fyi)**

## 🏗️ Architecture Overview

**Full-stack serverless application** with edge-first design:

```
beholder/
├── README.md           # This file
├── frontend/          # Web interface (Cloudflare Pages)
├── api/              # REST API (Cloudflare Worker)  
├── database/         # D1 schema & migrations
└── python/           # Data collection & AI evaluation tools
```

**Tech Stack:**
- **Frontend**: Vanilla JS + Deck.gl + Google Maps API + H3 spatial indexing
- **API**: Cloudflare Worker with D1 database integration
- **Database**: Cloudflare D1 (SQLite) with H3 hexagonal spatial indexing
- **AI**: Google Gemini 2.0 Flash for aesthetic evaluation
- **Data Collection**: Python tools with asyncio for bulk processing
- **Infrastructure**: 100% Cloudflare (Pages + Workers + D1)

## 🎯 Key Features

### 🎨 **AI-Powered Aesthetic Analysis**
- **Gemini 2.0 Flash** evaluates street imagery for beauty, architecture, and atmosphere
- **Structured prompts** with consistent 1-10 scoring
- **Smart image selection** using Street View metadata API

### 🗺️ **Multi-Scale Visualization**
- **Zoom 16+**: Individual points with precise building-level locations
- **Zoom 9-15**: Neighborhood heatmap using H3 hexagon aggregation  
- **Zoom <9**: District-level overview with larger hexagons
- **Continuous color gradient** from red (poor) through yellow to green (excellent)

### ⚡ **Edge-First Performance**
- **Global CDN** via Cloudflare Pages and Workers
- **H3 spatial indexing** for O(log n) geographic queries
- **Pre-aggregated heatmaps** at multiple resolutions
- **Real-time performance monitoring** with detailed client-side logging

### 🔍 **Interactive Exploration**
- **"Behold any place"** - search anywhere in the world
- **Smooth zoom transitions** between point and heatmap modes
- **Click-to-explore** detailed beauty scores and AI descriptions
- **Mobile-optimized** interface with touch controls

## 📊 Current Dataset

- **5,000+ locations evaluated** across London and expanding globally
- **H3 Resolution 7** (~1.4km hexagons) for district-level heatmaps
- **H3 Resolution 9** (~200m hexagons) for neighborhood-level detail
- **H3 Resolution 13** (~3m precision) for individual building locations
- **Average beauty score: 5.4/10** with detailed AI descriptions

## 🚀 Quick Start

### 1. Frontend Development
```bash
cd frontend
npx serve . -p 8080
# Open http://localhost:8080
```

### 2. API Development  
```bash
cd api
npm install
wrangler secret put GEMINI_API_KEY
wrangler secret put GOOGLE_MAPS_API_KEY
wrangler dev
```

### 3. Database Setup
```bash
cd database
wrangler d1 create beholder
wrangler d1 execute beholder --file=d1_schema.sql
```

### 4. Python Data Collection
```bash
cd python
uv sync
cp .env.example .env  # Add API keys
python beauty_evaluator.py --help
```

## 🔧 Component Details

### 🌐 Frontend (`/frontend`)
Interactive map visualization with sophisticated data handling:
- **Deck.gl WebGL rendering** for smooth 60fps hexagon visualization
- **Google Maps integration** for familiar navigation
- **Smart data fetching** with zoom-level optimizations
- **Client-side logging** for performance monitoring
- **Social media previews** with custom OpenGraph images

### ⚡ API (`/api`) 
Cloudflare Worker with modular architecture:
- **Street View optimization** using metadata API for best viewpoints
- **Gemini AI integration** with robust error handling and retries
- **H3 spatial calculations** for multi-resolution geographic indexing
- **Place ID deduplication** to prevent duplicate evaluations
- **CORS and rate limiting** for production deployment

### 🗄️ Database (`/database`)
Cloudflare D1 with spatial optimization:
- **H3 hexagonal indexing** at resolutions 7, 9, and 13
- **Pre-aggregated heat tables** for instant heatmap generation
- **Computed columns** for automatic average calculations
- **Strategic indexes** for fast geographic and beauty score queries

### 🐍 Python Tools (`/python`)
Production-grade data collection pipeline:
- **Hierarchical sampling** using H3 hexagons for even geographic coverage
- **Async processing** with configurable concurrency (25+ concurrent evaluations)
- **Smart coverage system** ensuring target density per geographic area
- **Exponential backoff** for reliable API handling
- **Progress tracking** with detailed logging and error recovery

## 📈 Performance & Monitoring

### Current Metrics (from production):
- **Response times**: 50-90ms median, 150ms P95
- **Data efficiency**: 
  - Hexagons: ~84B per item
  - Individual points: ~915B per item (includes full metadata)
- **Database reads**: Currently inefficient (20K rows/request), optimization planned
- **Global edge latency**: <100ms worldwide via Cloudflare

### Performance Testing:
```bash
# Run performance benchmarks
node frontend/performance-test.js

# Detailed analysis with item-level metrics
node frontend/performance-test-detailed.js
```

## 💰 Cost Structure

### Current Usage (Cloudflare):
- **D1 Database**: Pay per row read/written (currently inefficient)
- **Workers**: 100K requests/day free, then $5/month for 10M
- **Pages**: Free static hosting with global CDN

### Optimization Opportunities:
- **95% database cost reduction** possible with spatial query optimization
- **Client-side caching** to reduce API calls
- **Progressive loading** for large datasets

## 🛠️ Development Workflow

### Performance Monitoring:
Every API request logs detailed metrics to browser console:
```
📊 147 lg hex (R7) | 12.1KB (84B/item) | 67ms | beauty:5.6
📊 11 pts (11 w/meta) | 9.8KB (915B/item) | 35ms | beauty:5.7
```

### API Endpoints:
- **`POST /point`** - Evaluate new location with AI
- **`GET /heat?bbox=w,s,e,n&z=zoom`** - Hexagon heatmap data  
- **`GET /points?bbox=w,s,e,n`** - Individual points with metadata
- **`GET /maps-script`** - Secure Google Maps API key proxy

### Deployment:
```bash
# Frontend
wrangler pages deploy ./frontend --project-name beholder

# API  
cd api && wrangler deploy

# Database migrations
wrangler d1 execute beholder --file=database/migrations/new_migration.sql
```

## 🌍 Expanding Beyond London

The platform is designed for global expansion:
- **Geocoding supports worldwide addresses**
- **Street View coverage** spans 100+ countries
- **H3 indexing** provides consistent global spatial partitioning
- **AI evaluation** works across diverse architectural styles
- **Multi-language support** ready for international addresses

## 🎨 Color Scheme & Visualization

- **Red (α=150)**: Beauty scores 1-3 (poor aesthetic quality)
- **Transparent Yellow (α=30)**: Beauty scores 4-7 (neutral/average)  
- **Green (α=150)**: Beauty scores 8-10 (excellent aesthetic quality)
- **Continuous gradient**: Smooth interpolation between color stops
- **Alpha blending**: Allows map details to show through

## 📱 Mobile Experience

- **Touch-optimized**: Prevent accidental zoom, smooth panning
- **Responsive design**: Adapts from phone to desktop
- **Safe area support**: iOS notch and Android navigation handling
- **Offline resilience**: Graceful degradation when network is poor

## 🔐 Security & Privacy

- **API key protection**: Never exposed in frontend code
- **CORS restrictions**: Controlled origin access
- **Rate limiting**: Prevents API abuse
- **No personal data**: Only evaluates publicly visible street imagery
- **Open source**: Full transparency in AI evaluation process

## 📄 License

MIT License - Built for urban aesthetics research and public exploration.

---

🌍 **Behold any place. Discover beauty everywhere.**