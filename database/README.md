# 🗄️ Database Schema & Migrations

PostgreSQL database schema optimized for spatial beauty data with H3 hexagonal indexing.

## 🎯 Design Goals

- **Multi-resolution spatial indexing** using H3 hexagons
- **Real-time aggregation** via PostgreSQL triggers  
- **Place ID deduplication** to prevent duplicate evaluations
- **Simplified schema** without PostGIS complexity
- **High performance** with O(1) writes and fast reads

## 📁 Structure

```
database/
├── migrations/
│   └── 001_init.sql    # Complete schema initialization
└── README.md           # This file
```

## 🚀 Setup

```bash
# Connect to your Neon database
psql 'postgresql://your-connection-string'

# Run migrations
\i database/migrations/001_init.sql
```

## 🏗️ Schema Overview

### Core Tables

#### `points` - Main Data Table
```sql
CREATE TABLE points (
    id BIGSERIAL PRIMARY KEY,
    place_id TEXT UNIQUE NOT NULL,        -- Google Place ID
    beauty NUMERIC(3,1) NOT NULL,         -- Score 1.0-10.0
    description TEXT NOT NULL,            -- AI evaluation text
    model_version TEXT NOT NULL,          -- e.g., "gemini-2.5-flash"
    address TEXT NOT NULL,               -- Human-readable address
    lat NUMERIC(10,8) NOT NULL,          -- Latitude
    lng NUMERIC(11,8) NOT NULL,          -- Longitude
    -- H3 indexes auto-calculated from coordinates
    h3_r13 H3INDEX GENERATED ALWAYS AS (...), -- ~3m precision
    h3_r9 H3INDEX GENERATED ALWAYS AS (...),  -- ~200m precision  
    h3_r7 H3INDEX GENERATED ALWAYS AS (...),  -- ~1.4km precision
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Heat Aggregation Tables
Pre-computed averages for fast heatmap rendering:

```sql
-- Neighborhood level (~200m hexagons)
CREATE TABLE heat_r9 (
    h3 H3INDEX PRIMARY KEY,
    sum NUMERIC NOT NULL DEFAULT 0,
    cnt INTEGER NOT NULL DEFAULT 0,
    avg NUMERIC(3,1) GENERATED ALWAYS AS (
        CASE WHEN cnt > 0 THEN ROUND(sum / cnt, 1) ELSE NULL END
    ) STORED
);

-- District level (~1.4km hexagons)  
CREATE TABLE heat_r7 (
    h3 H3INDEX PRIMARY KEY,
    sum NUMERIC NOT NULL DEFAULT 0,
    cnt INTEGER NOT NULL DEFAULT 0,
    avg NUMERIC(3,1) GENERATED ALWAYS AS (
        CASE WHEN cnt > 0 THEN ROUND(sum / cnt, 1) ELSE NULL END
    ) STORED
);
```

### Indexes

**Performance Optimized:**
- `place_id` - Unique constraint for deduplication
- `h3_r13/r9/r7` - Spatial indexes for viewport queries
- `avg` - Partial indexes on heat tables (WHERE avg IS NOT NULL)

## ⚡ Real-Time Aggregation

**Automatic Updates via Triggers:**
```sql
CREATE OR REPLACE FUNCTION update_heat_aggregates() RETURNS TRIGGER AS $$
BEGIN
  -- Update both R9 and R7 heat tables automatically
  INSERT INTO heat_r9 (h3, sum, cnt) VALUES (NEW.h3_r9, NEW.beauty, 1)
  ON CONFLICT (h3) DO UPDATE SET sum = sum + EXCLUDED.sum, cnt = cnt + 1;
  
  INSERT INTO heat_r7 (h3, sum, cnt) VALUES (NEW.h3_r7, NEW.beauty, 1)  
  ON CONFLICT (h3) DO UPDATE SET sum = sum + EXCLUDED.sum, cnt = cnt + 1;
  
  RETURN NEW;
END$$ LANGUAGE plpgsql;
```

**Benefits:**
- **O(1) writes** - Each insert updates only 2 hex aggregates
- **Real-time updates** - No batch processing needed  
- **Consistent data** - Heat maps always reflect latest points

## 🗺️ H3 Spatial Strategy

### Multi-Resolution Approach
- **H3-R13** (~3m) - Building-level precision for individual points
- **H3-R9** (~200m) - Neighborhood aggregation for medium zoom
- **H3-R7** (~1.4km) - District aggregation for low zoom

### Query Patterns
```sql
-- Individual points (high zoom)
SELECT * FROM points WHERE h3_r13 = ANY(hexagons_in_viewport);

-- Heatmap data (medium zoom)
SELECT h3, avg FROM heat_r9 WHERE h3 = ANY(hexagons_in_viewport);

-- Heatmap data (low zoom)  
SELECT h3, avg FROM heat_r7 WHERE h3 = ANY(hexagons_in_viewport);
```

## 🔒 Data Integrity

### Constraints
- **Unique Place IDs** - Prevents duplicate evaluations
- **Beauty score range** - CHECK constraint (1.0 ≤ beauty ≤ 10.0)
- **Required fields** - NOT NULL constraints on core data

### Deduplication
```sql
-- Automatic deduplication via unique constraint
CREATE UNIQUE INDEX points_place_id_unique ON points (place_id) 
WHERE place_id IS NOT NULL;
```

## 📊 Performance Characteristics

**Expected Performance (10M points):**
- **Insert**: ~1ms (2 hex aggregate updates)
- **Heatmap query**: ~10ms (indexed lookup on aggregated data)
- **Individual points**: ~20ms (H3 index scan)
- **Database size**: ~2GB (10M points + 1M heat aggregates)

## 🛠️ Extensions Required

- **H3** - Hexagonal spatial indexing
- **Standard PostgreSQL** - No PostGIS needed

Optimized for serverless databases like Neon with automatic scaling and minimal maintenance.