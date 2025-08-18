#!/usr/bin/env python3
"""
Async bulk sampler for London Beauty Heatmap.
Samples random London locations and sends them to the Worker API for processing.
"""

import asyncio
import aiohttp
import time
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
import json
from pathlib import Path
import argparse
from datetime import datetime
from coordinates import generate_random_london_coordinates, generate_grid_coordinates, coordinates_to_address_string

# Configuration
API_BASE_URL = "https://beholder.josephmiller101.workers.dev"
LOCAL_API_URL = "http://localhost:8787"

@dataclass
class SamplingStats:
    """Track sampling statistics."""
    total_attempted: int = 0
    successful: int = 0
    failed: int = 0
    duplicates: int = 0
    no_imagery: int = 0
    start_time: float = 0
    
    def print_summary(self):
        elapsed = time.time() - self.start_time
        print(f"\n📊 SAMPLING SUMMARY")
        print(f"{'='*50}")
        print(f"✅ Successful: {self.successful}")
        print(f"⚠️  Duplicates: {self.duplicates}")
        print(f"🚫 No imagery: {self.no_imagery}")
        print(f"❌ Failed: {self.failed}")
        print(f"📈 Total attempted: {self.total_attempted}")
        print(f"⏱️  Time elapsed: {elapsed:.1f}s")
        print(f"⚡ Rate: {self.total_attempted/elapsed:.1f} attempts/sec")
        if self.successful > 0:
            print(f"💰 Avg time per success: {elapsed/self.successful:.1f}s")


class BulkSampler:
    """Async bulk sampler for London locations."""
    
    def __init__(self, api_url: str = API_BASE_URL, max_concurrent: int = 10):
        self.api_url = api_url.rstrip('/')
        self.max_concurrent = max_concurrent
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.stats = SamplingStats()
        self.results = []
        
    def generate_random_london_address(self) -> str:
        """Generate a random address string within London."""
        lat, lng = generate_random_london_coordinates()
        return coordinates_to_address_string(lat, lng)
    
    def generate_grid_addresses(self, grid_size: int = 10) -> List[str]:
        """Generate addresses in a grid pattern across London."""
        coordinates = generate_grid_coordinates(grid_size)
        return [coordinates_to_address_string(lat, lng) for lat, lng in coordinates]
    
    async def process_single_location(self, session: aiohttp.ClientSession, address: str) -> Optional[Dict[str, Any]]:
        """Process a single location through the API."""
        async with self.semaphore:
            self.stats.total_attempted += 1
            
            try:
                # Send to API
                async with session.post(
                    f'{self.api_url}/point',
                    json={'address': address},
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as response:
                    
                    if response.status in [200, 201]:
                        data = await response.json()
                        
                        # Check if it was a duplicate
                        if response.status == 200 and 'already exists' in data.get('message', ''):
                            self.stats.duplicates += 1
                            print(f"⚠️  Duplicate: {data['point']['address']} (Score: {data['point']['beauty']})")
                        else:
                            self.stats.successful += 1
                            point = data['point']
                            print(f"✅ Added: {point['address']} (Score: {point['beauty']}/10)")
                        
                        return data
                    
                    elif response.status == 400:
                        error_data = await response.json()
                        error_msg = error_data.get('error', 'Unknown error')
                        
                        if 'No Street View imagery' in error_msg:
                            self.stats.no_imagery += 1
                            print(f"🚫 No imagery for: {address[:50]}...")
                        else:
                            self.stats.failed += 1
                            print(f"❌ Failed: {error_msg[:100]}...")
                        
                        return None
                    
                    else:
                        self.stats.failed += 1
                        print(f"❌ Error {response.status} for {address[:50]}...")
                        return None
                        
            except asyncio.TimeoutError:
                self.stats.failed += 1
                print(f"⏱️  Timeout for {address[:50]}...")
                return None
            except Exception as e:
                self.stats.failed += 1
                print(f"❌ Exception for {address[:50]}...: {e}")
                return None
    
    async def sample_bulk(self, count: int, mode: str = 'random') -> List[Dict[str, Any]]:
        """Sample multiple locations in parallel."""
        print(f"🎯 Starting bulk sampling: {count} locations using {mode} mode")
        print(f"🌐 API: {self.api_url}")
        print(f"⚡ Max concurrent requests: {self.max_concurrent}")
        print(f"{'='*50}")
        
        self.stats = SamplingStats(start_time=time.time())
        
        # Generate addresses based on mode
        if mode == 'grid':
            grid_size = int(count ** 0.5) + 1
            addresses = self.generate_grid_addresses(grid_size)[:count]
        else:  # random
            addresses = [self.generate_random_london_address() for _ in range(count)]
        
        # Process all addresses concurrently
        async with aiohttp.ClientSession() as session:
            tasks = [self.process_single_location(session, addr) for addr in addresses]
            results = await asyncio.gather(*tasks)
        
        # Filter out None results
        self.results = [r for r in results if r is not None]
        
        self.stats.print_summary()
        return self.results
    
    async def sample_until_target(self, target: int, max_attempts: int = None) -> List[Dict[str, Any]]:
        """Keep sampling until we reach target number of successful points."""
        print(f"🎯 Sampling until {target} successful points")
        print(f"🌐 API: {self.api_url}")
        print(f"⚡ Max concurrent requests: {self.max_concurrent}")
        print(f"{'='*50}")
        
        self.stats = SamplingStats(start_time=time.time())
        if max_attempts is None:
            max_attempts = target * 3  # Assume ~33% success rate
        
        async with aiohttp.ClientSession() as session:
            while self.stats.successful < target and self.stats.total_attempted < max_attempts:
                # Calculate how many more to try
                remaining = target - self.stats.successful
                batch_size = min(remaining * 2, self.max_concurrent * 2)
                
                # Generate batch of addresses
                addresses = [self.generate_random_london_address() for _ in range(batch_size)]
                
                # Process batch
                tasks = [self.process_single_location(session, addr) for addr in addresses]
                batch_results = await asyncio.gather(*tasks)
                
                # Add successful results
                self.results.extend([r for r in batch_results if r is not None])
                
                # Small delay between batches
                if self.stats.successful < target:
                    await asyncio.sleep(0.5)
        
        self.stats.print_summary()
        return self.results[:target]
    
    def save_results(self, filename: str = None):
        """Save results to JSON file."""
        if not self.results:
            print("⚠️  No results to save")
            return
        
        if filename is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"sampling_results_{timestamp}.json"
        
        output_path = Path(filename)
        with open(output_path, 'w') as f:
            json.dump({
                'stats': {
                    'total_attempted': self.stats.total_attempted,
                    'successful': self.stats.successful,
                    'duplicates': self.stats.duplicates,
                    'no_imagery': self.stats.no_imagery,
                    'failed': self.stats.failed
                },
                'results': self.results,
                'timestamp': datetime.now().isoformat()
            }, f, indent=2)
        
        print(f"💾 Results saved to {output_path}")


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Bulk sample London locations for beauty heatmap')
    parser.add_argument('count', type=int, help='Number of locations to sample')
    parser.add_argument('--api-url', default=API_BASE_URL, help='API URL')
    parser.add_argument('--local', action='store_true', help='Use local API')
    parser.add_argument('--concurrent', type=int, default=10, help='Max concurrent requests')
    parser.add_argument('--mode', choices=['random', 'grid', 'until'], default='random', 
                       help='Sampling mode: random points, grid pattern, or until target reached')
    parser.add_argument('--save', action='store_true', help='Save results to JSON file')
    parser.add_argument('--output', type=str, help='Output filename')
    
    args = parser.parse_args()
    
    api_url = LOCAL_API_URL if args.local else args.api_url
    sampler = BulkSampler(api_url, max_concurrent=args.concurrent)
    
    if args.mode == 'until':
        results = await sampler.sample_until_target(args.count)
    else:
        results = await sampler.sample_bulk(args.count, mode=args.mode)
    
    if args.save:
        sampler.save_results(args.output)
    
    return results


if __name__ == "__main__":
    asyncio.run(main())