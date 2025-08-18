#!/usr/bin/env python3
"""
Smart idempotent beauty evaluator for hierarchical H3 sample points.
Ensures even coverage by checking existing database points and filling gaps.
"""

import asyncio
import aiohttp
import time
import json
import random
import subprocess
from typing import List, Dict, Any, Optional, Tuple, Set
from dataclasses import dataclass
from pathlib import Path
import argparse
from datetime import datetime
from tqdm import tqdm
import sys

# We'll need h3 for generating retry points within hexes
try:
    import h3
except ImportError:
    print("❌ h3 library not found. Install with: uv add h3")
    exit(1)

# Configuration
API_BASE_URL = "https://beholder.josephmiller101.workers.dev"
LOCAL_API_URL = "http://localhost:8787"

@dataclass
class SamplingStats:
    """Track sampling statistics with detailed breakdown."""
    total_attempted: int = 0
    successful: int = 0
    failed: int = 0
    duplicates: int = 0
    no_imagery: int = 0
    api_errors: int = 0
    timeouts: int = 0
    start_time: float = 0
    
    # Coverage tracking
    hexes_completed: int = 0
    hexes_partial: int = 0
    hexes_failed: int = 0
    
    def print_summary(self):
        elapsed = time.time() - self.start_time
        print(f"\n📊 SMART SAMPLING SUMMARY")
        print(f"{'='*60}")
        print(f"✅ Successful:     {self.successful:,}")
        print(f"⚠️  Duplicates:     {self.duplicates:,}")
        print(f"🚫 No imagery:     {self.no_imagery:,}")
        print(f"⏱️  Timeouts:       {self.timeouts:,}")
        print(f"❌ API errors:     {self.api_errors:,}")
        print(f"💥 Other fails:    {self.failed:,}")
        print(f"📈 Total attempts:  {self.total_attempted:,}")
        print(f"")
        print(f"🎯 COVERAGE:")
        print(f"   ✅ Hexes completed: {self.hexes_completed:,}")
        print(f"   ⚠️  Hexes partial:   {self.hexes_partial:,}")
        print(f"   ❌ Hexes failed:    {self.hexes_failed:,}")
        print(f"")
        print(f"⏱️  Time elapsed:   {elapsed:.1f}s")
        print(f"⚡ Rate:           {self.total_attempted/elapsed:.1f} requests/sec")
        if self.successful > 0:
            print(f"💰 Success rate:   {self.successful/self.total_attempted*100:.1f}%")


class SmartBeautyEvaluator:
    """Smart idempotent beauty evaluator with coverage tracking."""
    
    def __init__(self, api_url: str = API_BASE_URL, max_concurrent: int = 25):
        self.api_url = api_url.rstrip('/')
        self.max_concurrent = max_concurrent
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.stats = SamplingStats()
        self.results = []
        self.progress_bar = None
        
        # Coverage tracking
        self.target_points_per_hex = 1
        self.medium_hex_coverage = {}  # hex_id -> current_count
        self.failed_hexes = set()  # hexes that failed all retries
        
    def get_existing_coverage(self, database_name: str = "beholder-db") -> Dict[str, int]:
        """Query the D1 database using wrangler CLI to get existing point counts per medium hex."""
        print("🔍 Checking existing coverage in D1 database via wrangler...")
        
        try:
            # Use wrangler to query D1 database
            sql = "SELECT h3_r9, COUNT(*) as count FROM points GROUP BY h3_r9"
            
            result = subprocess.run([
                'npx', 'wrangler', 'd1', 'execute', database_name,
                '--command', sql,
                '--json', '--remote'
            ], capture_output=True, text=True, timeout=30, cwd='../api')
            
            if result.returncode == 0:
                data = json.loads(result.stdout)
                
                # Parse wrangler JSON response
                # Wrangler returns: [{"results": [{"h3_r9": "...", "count": 5}, ...]}]
                if isinstance(data, list) and len(data) > 0:
                    results = data[0].get('results', [])
                else:
                    results = data.get('results', [])
                coverage = {}
                
                for row in results:
                    hex_id = row.get('h3_r9')
                    count = row.get('count', 0)
                    if hex_id:
                        coverage[hex_id] = count
                
                print(f"📊 Found existing points in {len(coverage):,} medium hexes")
                total_points = sum(coverage.values())
                print(f"📈 Total existing points: {total_points:,}")
                return coverage
            else:
                print(f"⚠️  Wrangler command failed:")
                print(f"   stdout: {result.stdout}")
                print(f"   stderr: {result.stderr}")
                print("   Assuming empty database...")
                return {}
                
        except subprocess.TimeoutExpired:
            print("⚠️  Wrangler command timed out, assuming empty database...")
            return {}
        except json.JSONDecodeError as e:
            print(f"⚠️  Could not parse wrangler JSON output: {e}")
            print(f"   Raw output: {result.stdout}")
            print("   Assuming empty database...")
            return {}
        except FileNotFoundError:
            print("⚠️  Wrangler not found in PATH. Please install wrangler CLI.")
            print("   Assuming empty database...")
            return {}
        except Exception as e:
            print(f"⚠️  Could not check existing coverage: {e}")
            print("   Assuming empty database...")
            return {}
    
    def load_medium_hexes_from_sample_points(self, points_file: str) -> Dict[str, List[Tuple[float, float]]]:
        """Load all medium hexes and their sample coordinates from the file."""
        points_path = Path(points_file)
        if not points_path.exists():
            raise FileNotFoundError(f"Sample points file not found: {points_file}")
        
        with open(points_path, 'r') as f:
            data = json.load(f)
        
        # Group coordinates by medium hex
        hex_coordinates = {}
        for point in data:
            if 'lat' in point and 'lng' in point and 'medium_hex' in point:
                hex_id = point['medium_hex']
                coord = (point['lat'], point['lng'])
                
                if hex_id not in hex_coordinates:
                    hex_coordinates[hex_id] = []
                hex_coordinates[hex_id].append(coord)
        
        print(f"📍 Loaded {len(hex_coordinates):,} medium hexes with sample coordinates")
        return hex_coordinates
    
    def generate_additional_points_in_hex(self, hex_id: str, count: int = 3) -> List[Tuple[float, float]]:
        """Generate additional random points within a hexagon for retries."""
        try:
            # Get hexagon boundary
            boundary = h3.cell_to_boundary(hex_id)
            
            # Find bounding box
            lats = [lat for lat, lng in boundary]
            lngs = [lng for lat, lng in boundary]
            
            min_lat, max_lat = min(lats), max(lats)
            min_lng, max_lng = min(lngs), max(lngs)
            
            points = []
            attempts = 0
            max_attempts = count * 10
            
            while len(points) < count and attempts < max_attempts:
                # Generate random point in bounding box
                lat = random.uniform(min_lat, max_lat)
                lng = random.uniform(min_lng, max_lng)
                
                # Check if point is actually inside the hexagon
                if self._point_in_hex(lat, lng, hex_id):
                    points.append((lat, lng))
                
                attempts += 1
            
            return points
        except Exception as e:
            print(f"⚠️  Could not generate additional points for hex {hex_id}: {e}")
            return []
    
    def _point_in_hex(self, lat: float, lng: float, hex_id: str) -> bool:
        """Check if a point is inside a hexagon."""
        try:
            resolution = h3.get_resolution(hex_id)
            point_hex = h3.latlng_to_cell(lat, lng, resolution)
            return point_hex == hex_id
        except:
            return False
    
    def coordinates_to_address_string(self, lat: float, lng: float) -> str:
        """Convert coordinates to a standardized address string for the API."""
        return f"{lat:.6f},{lng:.6f}"
    
    async def process_single_location(self, session: aiohttp.ClientSession, lat: float, lng: float, hex_id: str) -> Optional[Dict[str, Any]]:
        """Process a single coordinate through the API."""
        async with self.semaphore:
            address = self.coordinates_to_address_string(lat, lng)
            
            try:
                async with session.post(
                    f'{self.api_url}/point',
                    json={'address': address},
                    timeout=aiohttp.ClientTimeout(total=45)
                ) as response:
                    
                    result = None
                    success = False
                    
                    if response.status in [200, 201]:
                        data = await response.json()
                        
                        if response.status == 200 and 'already exists' in data.get('message', ''):
                            self.stats.duplicates += 1
                            # Count as success for coverage purposes
                            success = True
                        else:
                            self.stats.successful += 1
                            success = True
                        
                        result = data
                    
                    elif response.status == 400:
                        error_data = await response.json()
                        error_msg = error_data.get('error', 'Unknown error')
                        
                        if 'No Street View imagery' in error_msg:
                            self.stats.no_imagery += 1
                        else:
                            self.stats.api_errors += 1
                    
                    else:
                        self.stats.api_errors += 1
                    
                    # Update coverage tracking
                    if success:
                        if hex_id not in self.medium_hex_coverage:
                            self.medium_hex_coverage[hex_id] = 0
                        self.medium_hex_coverage[hex_id] += 1
                    
                    return result
                        
            except asyncio.TimeoutError:
                self.stats.timeouts += 1
                return None
            except Exception as e:
                self.stats.failed += 1
                return None
            finally:
                self.stats.total_attempted += 1
    
    async def ensure_hex_coverage(self, session: aiohttp.ClientSession, hex_id: str, sample_coordinates: List[Tuple[float, float]], needed: int) -> bool:
        """Ensure a hex has the required number of points, with retries."""
        
        # Start with the provided sample coordinates
        candidates = sample_coordinates.copy()
        
        # Add additional random points for retries (up to 5 attempts per needed point)
        if len(candidates) < needed * 5:  # Want enough for all retry attempts
            additional = self.generate_additional_points_in_hex(hex_id, needed * 5 - len(candidates))
            candidates.extend(additional)
        
        # Shuffle for randomness
        random.shuffle(candidates)
        
        successes = 0
        attempts = 0
        max_attempts = min(len(candidates), needed * 5)  # Up to 5 attempts per needed point
        
        for lat, lng in candidates:
            if successes >= needed or attempts >= max_attempts:
                break
            
            # Add exponential backoff after failed attempts (but not on first attempt)
            if attempts > 0:
                backoff_delay = min(2 ** (attempts - 1), 8)  # 1s, 2s, 4s, 8s max
                await asyncio.sleep(backoff_delay)
            
            result = await self.process_single_location(session, lat, lng, hex_id)
            attempts += 1
            
            if result is not None:
                successes += 1
                if result not in self.results:
                    self.results.append(result)
        
        return successes >= needed
    
    async def process_smart_coverage(self, points_file: str, target_points_per_hex: int = 1, database_name: str = "beholder-db") -> List[Dict[str, Any]]:
        """Smart processing to ensure even coverage across all medium hexes."""
        self.target_points_per_hex = target_points_per_hex
        
        print(f"🧠 Smart coverage mode: {target_points_per_hex} point(s) per medium hex")
        print(f"🌐 API: {self.api_url}")
        print(f"⚡ Max concurrent: {self.max_concurrent}")
        print(f"{'='*60}")
        
        # Step 1: Check existing coverage
        existing_coverage = self.get_existing_coverage(database_name)
        self.medium_hex_coverage = existing_coverage.copy()
        
        # Step 2: Load all medium hexes and their sample coordinates  
        hex_coordinates = self.load_medium_hexes_from_sample_points(points_file)
        
        # Step 3: Determine which hexes need work
        hexes_needing_work = []
        for hex_id, coordinates in hex_coordinates.items():
            current_count = self.medium_hex_coverage.get(hex_id, 0)
            if current_count < target_points_per_hex:
                needed = target_points_per_hex - current_count
                hexes_needing_work.append((hex_id, coordinates, needed))
        
        print(f"📋 Coverage analysis:")
        print(f"   🏆 Hexes already complete: {len(hex_coordinates) - len(hexes_needing_work):,}")
        print(f"   🎯 Hexes needing work: {len(hexes_needing_work):,}")
        print(f"   📊 Total medium hexes: {len(hex_coordinates):,}")
        
        if not hexes_needing_work:
            print("🎉 All hexes already have target coverage!")
            return []
        
        # Step 4: Process hexes that need work
        self.stats = SamplingStats(start_time=time.time())
        
        # Track progress by hexes completed, not total attempts
        total_hexes_needed = len(hexes_needing_work)
        
        self.progress_bar = tqdm(
            total=total_hexes_needed,
            desc="Processing",
            unit="hex",
            ncols=120,
            file=sys.stdout
        )
        
        try:
            async with aiohttp.ClientSession(
                connector=aiohttp.TCPConnector(limit=self.max_concurrent * 2)
            ) as session:
                
                for hex_id, coordinates, needed in hexes_needing_work:
                    success = await self.ensure_hex_coverage(session, hex_id, coordinates, needed)
                    
                    final_count = self.medium_hex_coverage.get(hex_id, 0)
                    if final_count >= target_points_per_hex:
                        self.stats.hexes_completed += 1
                    elif final_count > 0:
                        self.stats.hexes_partial += 1
                    else:
                        self.stats.hexes_failed += 1
                        self.failed_hexes.add(hex_id)
                    
                    # Update progress bar after completing each hex
                    if self.progress_bar:
                        self.progress_bar.update(1)
                        # Update progress bar description
                        completed = len([h for h, c in self.medium_hex_coverage.items() if c >= self.target_points_per_hex])
                        self.progress_bar.set_description(
                            f"✅{self.stats.successful} 🎯{completed} hexes ⚠️{self.stats.duplicates} 🚫{self.stats.no_imagery} ❌{self.stats.failed + self.stats.api_errors + self.stats.timeouts}"
                        )
                    
                    # Small delay between hexes to be nice to the API
                    await asyncio.sleep(0.05)
            
        finally:
            if self.progress_bar:
                self.progress_bar.close()
        
        self.stats.print_summary()
        
        # Print failed hexes for debugging
        if self.failed_hexes:
            print(f"\n⚠️  Failed hexes (no successful points): {len(self.failed_hexes):,}")
            if len(self.failed_hexes) <= 10:
                for hex_id in list(self.failed_hexes)[:10]:
                    print(f"   {hex_id}")
            else:
                print(f"   (showing first 10: {list(self.failed_hexes)[:10]})")
        
        return self.results
    
    def save_results(self, filename: str = None):
        """Save results to JSON file with detailed metadata."""
        if not self.results:
            print("⚠️  No results to save")
            return
        
        if filename is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"smart_sampling_results_{timestamp}.json"
        
        output_path = Path(filename)
        
        # Prepare detailed output
        output_data = {
            'metadata': {
                'timestamp': datetime.now().isoformat(),
                'api_url': self.api_url,
                'max_concurrent': self.max_concurrent,
                'target_points_per_hex': self.target_points_per_hex,
                'processing_time_seconds': time.time() - self.stats.start_time
            },
            'stats': {
                'total_attempted': self.stats.total_attempted,
                'successful': self.stats.successful,
                'duplicates': self.stats.duplicates,
                'no_imagery': self.stats.no_imagery,
                'api_errors': self.stats.api_errors,
                'timeouts': self.stats.timeouts,
                'failed': self.stats.failed,
                'success_rate_percent': self.stats.successful / self.stats.total_attempted * 100 if self.stats.total_attempted > 0 else 0,
                'hexes_completed': self.stats.hexes_completed,
                'hexes_partial': self.stats.hexes_partial,
                'hexes_failed': self.stats.hexes_failed
            },
            'coverage': {
                'medium_hex_counts': self.medium_hex_coverage,
                'failed_hexes': list(self.failed_hexes)
            },
            'results': self.results
        }
        
        with open(output_path, 'w') as f:
            json.dump(output_data, f, indent=2)
        
        print(f"💾 Results saved to {output_path}")
        print(f"📊 {len(self.results):,} successful results saved")
        
        return output_path


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Smart idempotent beauty evaluator with coverage tracking')
    parser.add_argument('--points-file', default='debug_output/sample_points_all.json', 
                       help='JSON file containing sample points from coordinate_generator.py')
    parser.add_argument('--target-per-hex', type=int, default=1,
                       help='Target number of points per medium hex (default: 1)')
    parser.add_argument('--database', default='beholder-db',
                       help='D1 database name for wrangler (default: beholder-db)')
    parser.add_argument('--api-url', default=API_BASE_URL, help='API URL')
    parser.add_argument('--local', action='store_true', help='Use local API')
    parser.add_argument('--concurrent', type=int, default=25, 
                       help='Max concurrent requests (default: 25)')
    parser.add_argument('--save', action='store_true', default=True, help='Save results to JSON file')
    parser.add_argument('--output', type=str, help='Output filename')
    
    args = parser.parse_args()
    
    # Create sampler
    api_url = LOCAL_API_URL if args.local else args.api_url
    sampler = SmartBeautyEvaluator(api_url, max_concurrent=args.concurrent)
    
    try:
        # Process with smart coverage
        results = await sampler.process_smart_coverage(
            args.points_file, 
            target_points_per_hex=args.target_per_hex,
            database_name=args.database
        )
        
        # Save results
        if args.save:
            output_file = sampler.save_results(args.output)
            
            # Print some sample results
            if results:
                print(f"\n🎉 Sample results:")
                for i, result in enumerate(results[:3]):
                    point = result.get('point', {})
                    print(f"  {i+1}. Score: {point.get('beauty', 'N/A')}/10 at {point.get('address', 'N/A')[:60]}...")
                if len(results) > 3:
                    print(f"  ... and {len(results) - 3:,} more")
        
    except FileNotFoundError as e:
        print(f"❌ Error: {e}")
        print(f"💡 Make sure to run coordinate_generator.py first to generate sample points")
        return 1
    except KeyboardInterrupt:
        print(f"\n🛑 Interrupted by user")
        if sampler.results:
            print(f"💾 Saving {len(sampler.results)} partial results...")
            sampler.save_results("interrupted_smart_results.json")
        return 1
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return 1
    
    return 0


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)