-- Recreate get_points_in_viewport with image_url in the return type
DROP FUNCTION IF EXISTS get_points_in_viewport(numeric, numeric, numeric, numeric);

CREATE FUNCTION get_points_in_viewport(
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
  created_at TIMESTAMPTZ,
  image_url TEXT
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
    p.created_at,
    p.image_url
  FROM points p
  WHERE p.lat BETWEEN south AND north
    AND p.lng BETWEEN west AND east
  LIMIT 5000;
END$$ LANGUAGE plpgsql;


