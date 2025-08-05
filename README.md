# 🏙️ London Beauty Heatmap

A real-time interactive heatmap showing the aesthetic beauty of London streets, powered by AI analysis of Street View imagery.

## 🏗️ Monorepo Architecture

This is a **full-stack monorepo** with multiple components working together:

```
beholder/
├── README.md           # This file
├── frontend/          # Web interface (Cloudflare Pages)
├── api/              # REST API (Cloudflare Worker)  
├── database/         # PostgreSQL schema & migrations
└── python/           # Data collection & analysis tools
```

**Tech Stack:**
- **Frontend**: Vanilla JS + deck.gl + Google Maps API
- **API**: Cloudflare Worker with modular ES6 architecture
- **Database**: Neon PostgreSQL + H3 hexagonal indexing
- **Python Tools**: Street View sampling + Gemini AI evaluation
- **Infrastructure**: Cloudflare (Pages + Workers) + Neon Database

## 📁 Component Overview

### 🌐 [`/frontend`](./frontend) - Web Interface
Interactive heatmap visualization built with deck.gl:
- **Real-time heatmap** with zoom-adaptive layers
- **Individual point display** with building-level precision
- **Add new locations** via address input
- **Auto-fetch Street View** with optimal camera angles

### ⚡ [`/api`](./api) - Cloudflare Worker API
Modular serverless API with advanced features:
- **Optimized Street View** (Method 2 with metadata + heading calculation)
- **Gemini 2.5 Flash** AI aesthetic evaluation  
- **Google Place ID** deduplication
- **H3 spatial indexing** for fast queries
- **Modular architecture** (streetview.js, ai-evaluation.js, etc.)

### 🗄️ [`/database`](./database) - PostgreSQL Schema
Optimized spatial database design:
- **H3 hexagonal indexing** at multiple resolutions (R7/R9/R13)
- **Real-time aggregation** via PostgreSQL triggers
- **Place ID deduplication** for unique locations
- **Simplified schema** (no PostGIS complexity)

### 🐍 [`/python`](./python) - Data Collection Tools
Python utilities for bulk data collection:
- **London coordinate sampling** with bias toward interesting areas
- **Advanced Street View** optimization (metadata + heading)
- **Bulk AI evaluation** with cost estimation
- **Cache management** to avoid duplicate API calls
- **Upload to web platform** integration

## 🚀 Quick Start

### 1. Database Setup
```bash
# Connect to your Neon database
psql 'postgresql://your-connection-string'

# Run migrations
\i database/migrations/001_init.sql
```

### 2. API Deployment
```bash
cd api
npm install
wrangler secret put GEMINI_API_KEY
wrangler secret put GOOGLE_MAPS_API_KEY  
wrangler secret put DATABASE_URL
wrangler deploy
```

### 3. Frontend Deployment
```bash
# Update frontend/app.js with your API key
wrangler pages deploy ./frontend --project-name beauty-heatmap
```

### 4. Python Tools (Optional)
```bash
cd python
uv sync
cp .env.example .env  # Add your API keys
python main.py --help
```

## 🎯 Key Features

### 🔍 **Advanced Street View**
- **Metadata API** to find optimal panorama locations
- **Heading calculation** using spherical trigonometry  
- **Consistent quality** matching Google Maps interface

### 🤖 **Sophisticated AI Evaluation**
- **Detailed prompts** with specific examples and guidance
- **Robust parsing** with fallback number extraction
- **Score clamping** and validation (1-10 range)

### 🗺️ **Multi-Resolution Spatial Indexing**
- **H3-R13** (~3m) - Building-level precision for individual points
- **H3-R9** (~200m) - Neighborhood-level heatmap aggregation  
- **H3-R7** (~1.4km) - District-level heatmap for low zoom

### ⚡ **Performance Optimized**
- **O(1) writes** with automatic aggregation triggers
- **Pre-computed heatmaps** for instant visualization
- **Place ID deduplication** prevents duplicate evaluations

## 📊 Usage Patterns

### Web Interface
- **High zoom (16+)**: See individual building ratings with precise H3-R13 positioning
- **Medium zoom (11-15)**: Neighborhood heatmap using H3-R9 aggregation
- **Low zoom (<11)**: District overview using H3-R7 aggregation

### Python Tools
- **Bulk collection**: `python main.py --count 100`
- **Upload to web**: `python upload_to_heatmap.py --all`
- **Cost estimation**: Built-in Gemini API cost tracking

### API Integration
- **Add single point**: `POST /point {"address": "123 Baker St"}`
- **Get heatmap data**: `GET /heat?bbox=w,s,e,n&z=12`
- **Individual points**: `GET /points?bbox=w,s,e,n`

## 🔧 Development

Each component can be developed independently:

```bash
# API development
cd api && wrangler dev

# Frontend development  
cd frontend && python -m http.server 8080

# Python development
cd python && python main.py --help

# Database changes
psql $DATABASE_URL < database/migrations/new_migration.sql
```

## 📈 Architecture Benefits

### 🏗️ **Monorepo Advantages**
- **Shared types** and interfaces across components
- **Coordinated deployments** and versioning
- **Cross-component refactoring** support
- **Unified documentation** and setup

### ⚡ **Serverless Benefits**
- **Zero maintenance** infrastructure
- **Automatic scaling** from zero to millions
- **Global edge distribution** via Cloudflare
- **Pay-per-use** pricing model

### 🗄️ **Spatial Database Benefits**
- **Sub-millisecond queries** with H3 indexing
- **Real-time aggregation** without batch jobs
- **Hierarchical spatial data** for multi-zoom visualization
- **Deduplication** with Google Place IDs

## 🛠️ Required Services

- **Neon Database** - PostgreSQL with H3 extension
- **Cloudflare Workers** - Serverless API hosting
- **Cloudflare Pages** - Static site hosting  
- **Google Maps API** - Geocoding + Street View
- **Google Gemini API** - AI aesthetic evaluation

## 📄 License

MIT License - Built for urban aesthetics research and visualization.

---

🏙️ **Exploring the beauty of London, one street at a time.**