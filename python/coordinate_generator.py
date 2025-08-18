#!/usr/bin/env python3
"""
Hierarchical H3 sampling for London Beauty Heatmap.
Uses H3's hierarchical structure to systematically sample London.

Stages:
1. Find ~100 large hexagons (H3 resolution 7) covering central London
2. For each large hex, get all small hexagons (H3 resolution 13) inside it
3. Within each small hex, sample N random coordinate points
4. Generate debug outputs and visualizations
"""

import json
import random
from typing import List, Tuple, Dict, Set
from pathlib import Path
from datetime import datetime
import argparse

# We'll need to install h3 for this
try:
    import h3
except ImportError:
    print("❌ h3 library not found. Install with: pip install h3")
    print("   or: uv add h3")
    exit(1)


# H3 Resolutions matching the UI/database structure
H3_LARGE_RES = 7    # ~1.4km hexagons - shown at zoom 9-12 ("large" in UI)
H3_MEDIUM_RES = 9   # ~200m hexagons - shown at zoom 13-15 ("medium" in UI)  
H3_SMALL_RES = 13   # ~3m hexagons - individual points at zoom 16+ ("small" in database)

class HierarchicalSampler:
    """Hierarchical H3-based sampling for London."""
    
    def __init__(self, debug: bool = True):
        self.debug = debug
        self.large_hexagons: Set[str] = set()
        self.medium_hexagons: Dict[str, Set[str]] = {}  # large_hex -> set of medium hexes
        self.sample_points: Dict[str, List[Tuple[float, float]]] = {}  # medium_hex -> points
        
    def log(self, message: str):
        """Debug logging."""
        if self.debug:
            print(message)
    
    def stage1_find_central_london_hexagons(self, target_count: int = 100) -> Set[str]:
        """
        Stage 1: Find ~100 large H3 hexagons covering central London.
        
        Strategy:
        - Start from London center point
        - Use H3's k-ring algorithm to get surrounding hexagons
        - Filter to ensure they're within London bounds
        - Prioritize central hexagons over peripheral ones
        """
        self.log(f"🎯 Stage 1: Finding {target_count} central London hexagons (H3 res {H3_LARGE_RES})")
        
        # London center (user-specified)
        london_center_lat = 51.513281
        london_center_lng = -0.117465
        
        self.log(f"📍 London center: {london_center_lat:.6f}, {london_center_lng:.6f}")
        
        # Get the central hexagon
        center_hex = h3.latlng_to_cell(london_center_lat, london_center_lng, H3_LARGE_RES)
        hexagons = {center_hex}
        
        self.log(f"🏠 Center hexagon: {center_hex}")
        
        # Expand outward in rings until we have enough hexagons
        ring_distance = 1
        while len(hexagons) < target_count:
            # Get hexagons at this ring distance
            ring_hexes = set(h3.grid_disk(center_hex, ring_distance))
            
            # Add all hexagons in this ring
            new_hexes = ring_hexes - hexagons  # Only the new ones from this ring
            hexagons.update(new_hexes)
            
            self.log(f"🔄 Ring {ring_distance}: +{len(new_hexes)} hexagons, total: {len(hexagons)}")
            
            ring_distance += 1
            
            # Safety break
            if ring_distance > 10:
                self.log("⚠️  Reached maximum ring distance, stopping expansion")
                break
        
        # If we have too many, prioritize the most central ones
        if len(hexagons) > target_count:
            # Sort by distance from center and take the closest ones
            hex_distances = []
            for hex_id in hexagons:
                hex_center = h3.cell_to_latlng(hex_id)
                distance = self._haversine_distance(
                    london_center_lat, london_center_lng,
                    hex_center[0], hex_center[1]
                )
                hex_distances.append((distance, hex_id))
            
            hex_distances.sort()  # Sort by distance (closest first)
            hexagons = {hex_id for _, hex_id in hex_distances[:target_count]}
            
            self.log(f"✂️  Trimmed to closest {target_count} hexagons")
        
        self.large_hexagons = hexagons
        
        self.log(f"✅ Stage 1 complete: {len(self.large_hexagons)} large hexagons selected")
        self.log(f"📊 Coverage area: ~{len(self.large_hexagons) * 2.5:.1f} km²")
        
        return self.large_hexagons
    
    def _haversine_distance(self, lat1: float, lng1: float, lat2: float, lng2: float) -> float:
        """Calculate haversine distance between two points in km."""
        import math
        
        R = 6371  # Earth's radius in km
        
        lat1, lng1, lat2, lng2 = map(math.radians, [lat1, lng1, lat2, lng2])
        dlat = lat2 - lat1
        dlng = lng2 - lng1
        
        a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng/2)**2
        c = 2 * math.asin(math.sqrt(a))
        
        return R * c
    
    def stage2_get_child_hexagons(self) -> Dict[str, Set[str]]:
        """
        Stage 2: For each large hexagon, get all medium hexagons inside it.
        
        Uses H3's hierarchical structure to find all resolution-9 hexagons
        within each resolution-7 hexagon.
        """
        self.log(f"🔍 Stage 2: Finding child hexagons (H3 res {H3_MEDIUM_RES}) for each large hex")
        
        if not self.large_hexagons:
            raise ValueError("Must run stage1 first")
        
        total_medium_hexes = 0
        
        for large_hex in self.large_hexagons:
            # Get all medium hexagons within this large hexagon
            child_hexes = set(h3.cell_to_children(large_hex, H3_MEDIUM_RES))
            
            self.medium_hexagons[large_hex] = child_hexes
            total_medium_hexes += len(child_hexes)
            
            # Debug output for first few hexagons
            if len(self.medium_hexagons) <= 3:
                self.log(f"📦 Large hex {large_hex}: {len(child_hexes)} medium hexes")
        
        avg_children = total_medium_hexes / len(self.large_hexagons) if self.large_hexagons else 0
        
        self.log(f"✅ Stage 2 complete:")
        self.log(f"   📊 Total medium hexagons: {total_medium_hexes:,}")
        self.log(f"   📊 Average per large hex: {avg_children:.1f}")
        self.log(f"   📊 Expected children per parent: {7**(H3_MEDIUM_RES-H3_LARGE_RES)} = {7**(H3_MEDIUM_RES-H3_LARGE_RES):,}")  # H3 theory
        
        return self.medium_hexagons
    
    def stage3_sample_points_in_hexagons(self, points_per_hex: int = 5) -> Dict[str, List[Tuple[float, float]]]:
        """
        Stage 3: Within each medium hexagon, sample N random coordinate points.
        
        Args:
            points_per_hex: Number of random points to generate per medium hexagon
        """
        self.log(f"🎲 Stage 3: Sampling {points_per_hex} random points per medium hexagon")
        
        if not self.medium_hexagons:
            raise ValueError("Must run stage2 first")
        
        total_points = 0
        
        for large_hex, medium_hexes in self.medium_hexagons.items():
            for medium_hex in medium_hexes:
                points = self._generate_random_points_in_hex(medium_hex, points_per_hex)
                self.sample_points[medium_hex] = points
                total_points += len(points)
        
        self.log(f"✅ Stage 3 complete:")
        self.log(f"   📊 Total sample points: {total_points:,}")
        self.log(f"   📊 Points per medium hex: {points_per_hex}")
        self.log(f"   📊 Medium hexagons sampled: {len(self.sample_points):,}")
        
        return self.sample_points
    
    def _generate_random_points_in_hex(self, hex_id: str, count: int) -> List[Tuple[float, float]]:
        """Generate random points within a hexagon's boundary."""
        # Get hexagon boundary
        boundary = h3.cell_to_boundary(hex_id)
        
        # Find bounding box
        lats = [lat for lat, lng in boundary]
        lngs = [lng for lat, lng in boundary]
        
        min_lat, max_lat = min(lats), max(lats)
        min_lng, max_lng = min(lngs), max(lngs)
        
        points = []
        attempts = 0
        max_attempts = count * 10  # Prevent infinite loops
        
        while len(points) < count and attempts < max_attempts:
            # Generate random point in bounding box
            lat = random.uniform(min_lat, max_lat)
            lng = random.uniform(min_lng, max_lng)
            
            # Check if point is actually inside the hexagon
            if self._point_in_hex(lat, lng, hex_id):
                points.append((lat, lng))
            
            attempts += 1
        
        return points
    
    def _point_in_hex(self, lat: float, lng: float, hex_id: str) -> bool:
        """Check if a point is inside a hexagon (approximate)."""
        # Simple approach: check if the point's H3 representation matches the hex
        resolution = h3.get_resolution(hex_id)
        point_hex = h3.latlng_to_cell(lat, lng, resolution)
        return point_hex == hex_id
    
    def generate_debug_outputs(self, output_dir: str = "debug_output"):
        """Generate debug outputs and visualizations."""
        self.log(f"📊 Generating debug outputs to {output_dir}/")
        
        output_path = Path(output_dir)
        output_path.mkdir(exist_ok=True)
        
        # 1. Summary statistics
        summary = {
            "timestamp": datetime.now().isoformat(),
            "large_hexagons": {
                "count": len(self.large_hexagons),
                "resolution": H3_LARGE_RES,
                "hexagon_ids": list(self.large_hexagons)
            },
            "medium_hexagons": {
                "count": sum(len(hexes) for hexes in self.medium_hexagons.values()),
                "resolution": H3_MEDIUM_RES,
                "avg_per_large_hex": sum(len(hexes) for hexes in self.medium_hexagons.values()) / len(self.large_hexagons) if self.large_hexagons else 0
            },
            "sample_points": {
                "count": sum(len(points) for points in self.sample_points.values()),
                "avg_per_medium_hex": sum(len(points) for points in self.sample_points.values()) / len(self.sample_points) if self.sample_points else 0
            }
        }
        
        with open(output_path / "summary.json", "w") as f:
            json.dump(summary, f, indent=2)
        
        # 2. Large hexagon centers (for visualization)
        large_hex_centers = []
        for hex_id in self.large_hexagons:
            lat, lng = h3.cell_to_latlng(hex_id)
            large_hex_centers.append({
                "hex_id": hex_id,
                "lat": lat,
                "lng": lng,
                "child_count": len(self.medium_hexagons.get(hex_id, []))
            })
        
        with open(output_path / "large_hexagon_centers.json", "w") as f:
            json.dump(large_hex_centers, f, indent=2)
        
        # 3. Sample points (all points)
        sample_coords = []
        for medium_hex, points in self.sample_points.items():
            for lat, lng in points:
                sample_coords.append({
                    "lat": lat,
                    "lng": lng,
                    "medium_hex": medium_hex,
                    "large_hex": self._find_parent_hex(medium_hex)
                })
        
        # Save all sample points
        with open(output_path / "sample_points_all.json", "w") as f:
            json.dump(sample_coords, f, indent=2)
        
        # Also save a small sample for visualization
        with open(output_path / "sample_points.json", "w") as f:
            json.dump(sample_coords[:1000], f, indent=2)
        
        self.log(f"✅ Debug outputs generated:")
        self.log(f"   📄 {output_path}/summary.json")
        self.log(f"   📄 {output_path}/large_hexagon_centers.json")
        self.log(f"   📄 {output_path}/sample_points_all.json ({len(sample_coords):,} points)")
        self.log(f"   📄 {output_path}/sample_points.json (first 1000 points for visualization)")
    
    def _find_parent_hex(self, medium_hex: str) -> str:
        """Find which large hexagon contains this medium hexagon."""
        for large_hex, medium_hexes in self.medium_hexagons.items():
            if medium_hex in medium_hexes:
                return large_hex
        return "unknown"
    
    def run_full_pipeline(self, large_hex_count: int = 100, points_per_medium_hex: int = 5):
        """Run the complete hierarchical sampling pipeline."""
        self.log(f"🚀 Starting hierarchical H3 sampling pipeline")
        self.log(f"🎯 Target: {large_hex_count} large hexes, {points_per_medium_hex} points per medium hex")
        self.log("=" * 70)
        
        # Stage 1: Find central London hexagons
        self.stage1_find_central_london_hexagons(large_hex_count)
        self.log("")
        
        # Stage 2: Get child hexagons
        self.stage2_get_child_hexagons()
        self.log("")
        
        # Stage 3: Sample points
        self.stage3_sample_points_in_hexagons(points_per_medium_hex)
        self.log("")
        
        # Generate debug outputs
        self.generate_debug_outputs()
        self.log("")
        
        self.log("🎉 Pipeline complete!")


def main():
    parser = argparse.ArgumentParser(description='Hierarchical H3 sampling for London')
    parser.add_argument('--large-hexes', type=int, default=100, help='Number of large hexagons to find')
    parser.add_argument('--points-per-hex', type=int, default=5, help='Sample points per small hexagon') 
    parser.add_argument('--quiet', action='store_true', help='Disable debug output')
    parser.add_argument('--output-dir', default='debug_output', help='Output directory for debug files')
    
    args = parser.parse_args()
    
    sampler = HierarchicalSampler(debug=not args.quiet)
    sampler.run_full_pipeline(args.large_hexes, args.points_per_hex)
    
    if args.output_dir != 'debug_output':
        sampler.generate_debug_outputs(args.output_dir)


if __name__ == "__main__":
    main()