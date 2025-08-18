#!/usr/bin/env python3
"""
Enhanced bulk sampler for hierarchical H3 sample points.
Loads sample points from hierarchical_sampler.py output and processes them with progress tracking.
"""

import asyncio
import aiohttp
import time
import json
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from pathlib import Path
import argparse
from datetime import datetime
from tqdm import tqdm
import sys

# Configuration
API_BASE_URL = "https://beholder.josephmiller101.workers.dev"
LOCAL_API_URL = "http://localhost:8787"

@dataclass
class SamplingStats:
    """Track sampling statistics with detailed timing."""
    total_attempted: int = 0
    successful: int = 0
    failed: int = 0
    duplicates: int = 0
    no_imagery: int = 0
    api_errors: int = 0
    timeouts: int = 0
    start_time: float = 0
    
    def print_summary(self):
        elapsed = time.time() - self.start_time
        print(f"\n📊 SAMPLING SUMMARY")
        print(f"{'='*60}")
        print(f"✅ Successful:     {self.successful:,}")
        print(f"⚠️  Duplicates:     {self.duplicates:,}")
        print(f"🚫 No imagery:     {self.no_imagery:,}")
        print(f"⏱️  Timeouts:       {self.timeouts:,}")
        print(f"❌ API errors:     {self.api_errors:,}")
        print(f"💥 Other fails:    {self.failed:,}")
        print(f"📈 Total attempts:  {self.total_attempted:,}")
        print(f"⏱️  Time elapsed:   {elapsed:.1f}s")
        print(f"⚡ Rate:           {self.total_attempted/elapsed:.1f} requests/sec")
        if self.successful > 0:
            print(f"💰 Success rate:   {self.successful/self.total_attempted*100:.1f}%")
            print(f"⌛ Time per success: {elapsed/self.successful:.1f}s")


class HierarchicalBulkSampler:
    """Enhanced bulk sampler for hierarchical H3 sample points."""
    
    def __init__(self, api_url: str = API_BASE_URL, max_concurrent: int = 25):
        self.api_url = api_url.rstrip('/')
        self.max_concurrent = max_concurrent
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.stats = SamplingStats()
        self.results = []
        self.progress_bar = None
        
    def load_sample_points(self, points_file: str) -> List[Tuple[float, float]]:
        """Load sample points from hierarchical sampler JSON output."""
        points_path = Path(points_file)
        if not points_path.exists():
            raise FileNotFoundError(f"Sample points file not found: {points_file}")
        
        with open(points_path, 'r') as f:
            data = json.load(f)
        
        # Extract coordinates from the JSON structure
        coordinates = []
        if isinstance(data, list):
            for point in data:
                if 'lat' in point and 'lng' in point:
                    coordinates.append((point['lat'], point['lng']))
        
        print(f"📍 Loaded {len(coordinates):,} sample points from {points_file}")
        return coordinates
    
    def coordinates_to_address_string(self, lat: float, lng: float) -> str:
        """Convert coordinates to a standardized address string for the API."""
        return f"{lat:.6f},{lng:.6f}"
    
    async def process_single_location(self, session: aiohttp.ClientSession, lat: float, lng: float) -> Optional[Dict[str, Any]]:
        """Process a single coordinate through the API."""
        async with self.semaphore:
            address = self.coordinates_to_address_string(lat, lng)
            
            try:
                # Send to API
                async with session.post(
                    f'{self.api_url}/point',
                    json={'address': address},
                    timeout=aiohttp.ClientTimeout(total=45)  # Increased timeout for better reliability
                ) as response:
                    
                    result = None
                    if response.status in [200, 201]:
                        data = await response.json()
                        
                        # Check if it was a duplicate
                        if response.status == 200 and 'already exists' in data.get('message', ''):
                            self.stats.duplicates += 1
                            result = data
                        else:
                            self.stats.successful += 1
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
                    
                    return result
                        
            except asyncio.TimeoutError:
                self.stats.timeouts += 1
                return None
            except Exception as e:
                self.stats.failed += 1
                return None
            finally:
                self.stats.total_attempted += 1
                if self.progress_bar:
                    self.progress_bar.update(1)
                    # Update progress bar description with current stats
                    self.progress_bar.set_description(
                        f"✅{self.stats.successful} ⚠️{self.stats.duplicates} 🚫{self.stats.no_imagery} ❌{self.stats.failed + self.stats.api_errors + self.stats.timeouts}"
                    )
    
    async def process_coordinates_batch(self, coordinates: List[Tuple[float, float]], batch_size: int = 50) -> List[Dict[str, Any]]:
        """Process coordinates in batches to avoid overwhelming the API."""
        print(f"🚀 Processing {len(coordinates):,} coordinates")
        print(f"🌐 API: {self.api_url}")
        print(f"⚡ Max concurrent: {self.max_concurrent}")
        print(f"📦 Batch size: {batch_size}")
        print(f"{'='*60}")
        
        self.stats = SamplingStats(start_time=time.time())
        
        # Initialize progress bar
        self.progress_bar = tqdm(
            total=len(coordinates),
            desc="Processing",
            unit="req",
            ncols=100,
            file=sys.stdout
        )
        
        try:
            async with aiohttp.ClientSession(
                connector=aiohttp.TCPConnector(limit=self.max_concurrent * 2)
            ) as session:
                
                # Process in batches to manage memory and connections
                for i in range(0, len(coordinates), batch_size):
                    batch = coordinates[i:i + batch_size]
                    
                    # Create tasks for this batch
                    tasks = [
                        self.process_single_location(session, lat, lng)
                        for lat, lng in batch
                    ]
                    
                    # Process batch
                    batch_results = await asyncio.gather(*tasks, return_exceptions=True)
                    
                    # Add successful results
                    for result in batch_results:
                        if isinstance(result, dict):
                            self.results.append(result)
                    
                    # Small delay between batches to be nice to the API
                    if i + batch_size < len(coordinates):
                        await asyncio.sleep(0.1)
            
        finally:
            if self.progress_bar:
                self.progress_bar.close()
        
        self.stats.print_summary()
        return self.results
    
    def save_results(self, filename: str = None):
        """Save results to JSON file with detailed metadata."""
        if not self.results:
            print("⚠️  No results to save")
            return
        
        if filename is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"hierarchical_sampling_results_{timestamp}.json"
        
        output_path = Path(filename)
        
        # Prepare detailed output
        output_data = {
            'metadata': {
                'timestamp': datetime.now().isoformat(),
                'api_url': self.api_url,
                'max_concurrent': self.max_concurrent,
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
                'success_rate_percent': self.stats.successful / self.stats.total_attempted * 100 if self.stats.total_attempted > 0 else 0
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
    parser = argparse.ArgumentParser(description='Process hierarchical H3 sample points for beauty heatmap')
    parser.add_argument('--points-file', default='debug_output/sample_points.json', 
                       help='JSON file containing sample points from hierarchical_sampler.py')
    parser.add_argument('--api-url', default=API_BASE_URL, help='API URL')
    parser.add_argument('--local', action='store_true', help='Use local API')
    parser.add_argument('--concurrent', type=int, default=25, 
                       help='Max concurrent requests (default: 25, good balance for API limits)')
    parser.add_argument('--batch-size', type=int, default=50,
                       help='Process in batches of this size (default: 50)')
    parser.add_argument('--limit', type=int, help='Limit number of points to process (for testing)')
    parser.add_argument('--save', action='store_true', default=True, help='Save results to JSON file')
    parser.add_argument('--output', type=str, help='Output filename')
    
    args = parser.parse_args()
    
    # Create sampler
    api_url = LOCAL_API_URL if args.local else args.api_url
    sampler = HierarchicalBulkSampler(api_url, max_concurrent=args.concurrent)
    
    try:
        # Load sample points
        coordinates = sampler.load_sample_points(args.points_file)
        
        # Apply limit if specified (useful for testing)
        if args.limit:
            coordinates = coordinates[:args.limit]
            print(f"🎯 Limited to first {len(coordinates):,} points for testing")
        
        # Process all coordinates
        results = await sampler.process_coordinates_batch(coordinates, batch_size=args.batch_size)
        
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
        print(f"💡 Make sure to run hierarchical_sampler.py first to generate sample points")
        return 1
    except KeyboardInterrupt:
        print(f"\n🛑 Interrupted by user")
        if sampler.results:
            print(f"💾 Saving {len(sampler.results)} partial results...")
            sampler.save_results("interrupted_results.json")
        return 1
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return 1
    
    return 0


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)