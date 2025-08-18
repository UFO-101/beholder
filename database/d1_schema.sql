-- London Beauty Heatmap D1 Database Schema
-- SQLite/D1 compatible version
-- Converted from PostgreSQL with H3 calculations moved to JavaScript

-- Main points table with beauty ratings
CREATE TABLE IF NOT EXISTS points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id TEXT UNIQUE NOT NULL,
    beauty REAL NOT NULL CHECK (beauty >= 1 AND beauty <= 10),
    description TEXT NOT NULL,
    model_version TEXT NOT NULL,
    address TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    -- H3 values computed in JavaScript and stored as TEXT
    h3_r13 TEXT NOT NULL, -- ~3m - building-level precision
    h3_r9 TEXT NOT NULL,  -- ~200m - for medium zoom
    h3_r7 TEXT NOT NULL,  -- ~1.4km - for low zoom
    image_url TEXT,       -- Added in migration 002
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_points_place_id ON points (place_id);
CREATE INDEX IF NOT EXISTS idx_points_h3_r13 ON points (h3_r13);
CREATE INDEX IF NOT EXISTS idx_points_h3_r9 ON points (h3_r9);
CREATE INDEX IF NOT EXISTS idx_points_h3_r7 ON points (h3_r7);
CREATE INDEX IF NOT EXISTS idx_points_lat_lng ON points (lat, lng);

-- Heat aggregation tables for heatmap at different zoom levels
-- Resolution 9: ~200m diameter (zoom 13-15) - neighborhood level
CREATE TABLE IF NOT EXISTS heat_r9 (
    h3 TEXT PRIMARY KEY,
    sum REAL NOT NULL DEFAULT 0,
    cnt INTEGER NOT NULL DEFAULT 0,
    avg REAL GENERATED ALWAYS AS (
        CASE WHEN cnt > 0 THEN ROUND(sum / cnt, 1) ELSE NULL END
    ) STORED
);

-- Resolution 7: ~1.4km diameter (zoom 9-12) - district level  
CREATE TABLE IF NOT EXISTS heat_r7 (
    h3 TEXT PRIMARY KEY,
    sum REAL NOT NULL DEFAULT 0,
    cnt INTEGER NOT NULL DEFAULT 0,
    avg REAL GENERATED ALWAYS AS (
        CASE WHEN cnt > 0 THEN ROUND(sum / cnt, 1) ELSE NULL END
    ) STORED
);

-- Indexes on heat tables for fast lookups
CREATE INDEX IF NOT EXISTS idx_heat_r9_avg ON heat_r9 (avg) WHERE avg IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_heat_r7_avg ON heat_r7 (avg) WHERE avg IS NOT NULL;

