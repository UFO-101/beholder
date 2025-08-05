-- London Beauty Heatmap Database Schema
-- Pure H3-based spatial indexing for elegant querying

-- Enable H3 extension for hexagonal indexing
CREATE EXTENSION IF NOT EXISTS h3;

-- Main points table with beauty ratings
CREATE TABLE points (
    id BIGSERIAL PRIMARY KEY,
    place_id TEXT UNIQUE NOT NULL,
    beauty NUMERIC(3,1) NOT NULL CHECK (beauty >= 1 AND beauty <= 10),
    description TEXT NOT NULL,
    model_version TEXT NOT NULL,
    address TEXT NOT NULL,
    lat NUMERIC(10,8) NOT NULL,
    lng NUMERIC(11,8) NOT NULL,
    -- H3 at multiple resolutions for different zoom levels
    h3_r13 H3INDEX GENERATED ALWAYS AS (h3_lat_lng_to_cell(point(lng, lat), 13)) STORED, -- ~3m - building-level precision
    h3_r9 H3INDEX GENERATED ALWAYS AS (h3_lat_lng_to_cell(point(lng, lat), 9)) STORED,   -- ~200m - for medium zoom
    h3_r7 H3INDEX GENERATED ALWAYS AS (h3_lat_lng_to_cell(point(lng, lat), 7)) STORED,   -- ~1.4km - for low zoom
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX points_place_id_idx ON points (place_id);

-- Pure H3 indexes - no lat/lng spatial indexes needed!
CREATE INDEX points_h3_r13_idx ON points (h3_r13); -- For individual point queries (building-level)
CREATE INDEX points_h3_r9_idx ON points (h3_r9);   -- For medium zoom heatmap
CREATE INDEX points_h3_r7_idx ON points (h3_r7);   -- For low zoom heatmap

-- Heat aggregation tables for heatmap at different zoom levels
-- Resolution 9: ~200m diameter (zoom 11-15) - neighborhood level
CREATE TABLE heat_r9 (
    h3 H3INDEX PRIMARY KEY,
    sum NUMERIC NOT NULL DEFAULT 0,
    cnt INTEGER NOT NULL DEFAULT 0,
    avg NUMERIC(3,1) GENERATED ALWAYS AS (
        CASE WHEN cnt > 0 THEN ROUND(sum / cnt, 1) ELSE NULL END
    ) STORED
);

-- Resolution 7: ~1.4km diameter (zoom < 11) - district level  
CREATE TABLE heat_r7 (
    h3 H3INDEX PRIMARY KEY,
    sum NUMERIC NOT NULL DEFAULT 0,
    cnt INTEGER NOT NULL DEFAULT 0,
    avg NUMERIC(3,1) GENERATED ALWAYS AS (
        CASE WHEN cnt > 0 THEN ROUND(sum / cnt, 1) ELSE NULL END
    ) STORED
);

-- Indexes on heat tables for fast lookups
CREATE INDEX heat_r9_avg_idx ON heat_r9 (avg) WHERE avg IS NOT NULL;
CREATE INDEX heat_r7_avg_idx ON heat_r7 (avg) WHERE avg IS NOT NULL;

-- Function to update heat tables automatically
CREATE OR REPLACE FUNCTION update_heat_aggregates() RETURNS TRIGGER AS $$
BEGIN
  -- Update resolution 9 (medium zoom heatmap)
  INSERT INTO heat_r9 (h3, sum, cnt)
       VALUES (NEW.h3_r9, NEW.beauty, 1)
  ON CONFLICT (h3) DO UPDATE
       SET sum = heat_r9.sum + EXCLUDED.sum,
           cnt = heat_r9.cnt + 1;
  
  -- Update resolution 7 (low zoom heatmap)
  INSERT INTO heat_r7 (h3, sum, cnt)
       VALUES (NEW.h3_r7, NEW.beauty, 1)
  ON CONFLICT (h3) DO UPDATE
       SET sum = heat_r7.sum + EXCLUDED.sum,
           cnt = heat_r7.cnt + 1;
  
  RETURN NEW;
END$$ LANGUAGE plpgsql;

-- Trigger to automatically update heat tables on insert
CREATE TRIGGER t_update_heat AFTER INSERT ON points
FOR EACH ROW EXECUTE FUNCTION update_heat_aggregates();

-- Simplified helper functions - complex H3 viewport functions can be added later
-- For now, these work with basic bounding box queries

-- Function to get individual points in viewport (for high zoom)
CREATE OR REPLACE FUNCTION get_points_in_viewport(
  west NUMERIC, 
  south NUMERIC, 
  east NUMERIC, 
  north NUMERIC
)
RETURNS TABLE(
  id BIGINT,
  place_id TEXT,
  lat NUMERIC,
  lng NUMERIC,
  beauty NUMERIC,
  description TEXT,
  address TEXT,
  model_version TEXT,
  h3_r13 H3INDEX,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.place_id,
    p.lat,
    p.lng,
    p.beauty,
    p.description,
    p.address,
    p.model_version,
    p.h3_r13,
    p.created_at
  FROM points p
  WHERE p.lat BETWEEN south AND north
    AND p.lng BETWEEN west AND east
  LIMIT 5000;
END$$ LANGUAGE plpgsql;