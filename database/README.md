# 🗄️ Beholder Database

Cloudflare D1 (SQLite) database with H3 spatial indexing for efficient heatmap queries at multiple zoom levels.

## 🎯 Design Goals

- **Multi-resolution spatial indexing** using H3 hexagons (computed in JavaScript)
- **Real-time aggregation** via Worker-based updates  
- **Place ID deduplication** to prevent duplicate evaluations
- **Edge performance** with D1's global distribution
- **Simplified architecture** - no external database dependencies

## 📁 Structure

```
database/
├── d1_schema.sql       # Complete D1 schema
└── README.md           # This file
```

## 🚀 Setup

```bash
# Create D1 database
npx wrangler d1 create beholder

# Apply schema to production
npx wrangler d1 execute beholder --file=d1_schema.sql --remote
```

**Database:** `beholder` (fed59963-34cd-45fe-8c8a-b3b72141ac77)

## 🏗️ Schema Overview

### Core Tables

#### `points` - Main Data Table
```sql
CREATE TABLE points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id TEXT UNIQUE NOT NULL,        -- Google Place ID
    beauty REAL NOT NULL,                 -- Score 1.0-10.0
    description TEXT NOT NULL,            -- AI evaluation text
    model_version TEXT NOT NULL,          -- e.g., "gemini-2.5-flash"
    address TEXT NOT NULL,               -- Human-readable address
    lat REAL NOT NULL,                   -- Latitude
    lng REAL NOT NULL,                   -- Longitude
    -- H3 values computed in JavaScript and stored as TEXT
    h3_r13 TEXT NOT NULL,                -- ~3m precision
    h3_r9 TEXT NOT NULL,                 -- ~200m precision  
    h3_r7 TEXT NOT NULL,                 -- ~1.4km precision
    image_url TEXT,                      -- Street View image URL
    created_at TEXT DEFAULT (datetime('now'))
);
```

#### Heat Aggregation Tables
Pre-computed averages for fast heatmap rendering:

```sql
-- Neighborhood level (~200m hexagons)
CREATE TABLE heat_r9 (
    h3 TEXT PRIMARY KEY,
    sum REAL NOT NULL DEFAULT 0,
    cnt INTEGER NOT NULL DEFAULT 0,
    avg REAL GENERATED ALWAYS AS (
        CASE WHEN cnt > 0 THEN ROUND(sum / cnt, 1) ELSE NULL END
    ) STORED
);

-- District level (~1.4km hexagons)  
CREATE TABLE heat_r7 (
    h3 TEXT PRIMARY KEY,
    sum REAL NOT NULL DEFAULT 0,
    cnt INTEGER NOT NULL DEFAULT 0,
    avg REAL GENERATED ALWAYS AS (
        CASE WHEN cnt > 0 THEN ROUND(sum / cnt, 1) ELSE NULL END
    ) STORED
);
```

### Indexes

**Performance Optimized:**
- `place_id` - Unique constraint for deduplication
- `h3_r13/r9/r7` - Spatial indexes for viewport queries
- `lat, lng` - Compound index for spatial queries
- `avg` - Partial indexes on heat tables (WHERE avg IS NOT NULL)

## ⚡ JavaScript-Based Aggregation

**H3 Calculations in Worker:**
```javascript
import { latLngToCell } from 'h3-js';

// Calculate H3 indices at different resolutions
const h3_r7 = latLngToCell(lat, lng, 7);
const h3_r9 = latLngToCell(lat, lng, 9);
const h3_r13 = latLngToCell(lat, lng, 13);
```

**Heat Updates in Worker:**
```javascript
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
```

**Benefits:**
- **Edge latency** - ~10-20ms response times globally
- **No external database** - Integrated with Cloudflare Workers
- **Atomic updates** - Heat aggregation happens in single transaction
- **Cost effective** - Included with Workers, no separate database fees

## 🗺️ H3 Spatial Strategy

### Multi-Resolution Approach
- **H3-R13** (~3m) - Building-level precision for individual points
- **H3-R9** (~200m) - Neighborhood aggregation for medium zoom
- **H3-R7** (~1.4km) - District aggregation for low zoom

### Query Patterns
```sql
-- Individual points (high zoom)
SELECT * FROM points 
WHERE lat BETWEEN ? AND ? 
  AND lng BETWEEN ? AND ?

-- Heatmap data (medium zoom)
SELECT h3, avg FROM heat_r9 WHERE avg IS NOT NULL;

-- Heatmap data (low zoom)  
SELECT h3, avg FROM heat_r7 WHERE avg IS NOT NULL;
```

## 🔒 Data Integrity

### Constraints
- **Unique Place IDs** - Prevents duplicate evaluations
- **Beauty score range** - CHECK constraint (1.0 ≤ beauty ≤ 10.0)
- **Required fields** - NOT NULL constraints on core data

### Deduplication
```sql
-- Automatic deduplication via unique constraint
CREATE INDEX idx_points_place_id ON points (place_id);
```

## 📊 Performance Characteristics

**Expected Performance:**
- **Insert**: ~10-20ms (includes heat aggregation)
- **Heatmap query**: ~5-15ms (indexed lookup on aggregated data)
- **Individual points**: ~10-25ms (spatial range query)
- **Global latency**: Sub-50ms from anywhere via Cloudflare edge

## 🌍 Edge Architecture

- **D1 Database** - SQLite distributed globally via Cloudflare
- **Worker Integration** - Direct database access without network calls
- **Auto-scaling** - Scales with your Workers automatically
- **No maintenance** - Fully managed by Cloudflare

Perfect for serverless applications with global reach and minimal operational overhead.