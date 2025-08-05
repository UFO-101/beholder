#!/usr/bin/env python3
"""
Upload script to send London beauty data from the local sampling system 
to the live web heatmap via the Cloudflare Worker API.
"""

import os
import json
import requests
import base64
from pathlib import Path
from typing import Dict, Any, List, Optional
from dotenv import load_dotenv

load_dotenv()

# Configuration
API_BASE_URL = os.getenv('HEATMAP_API_URL', 'https://beauty-api.your-subdomain.workers.dev')
MAX_BATCH_SIZE = 10  # Process in batches to avoid timeouts

class HeatmapUploader:
    """Uploads local beauty data to the live heatmap."""
    
    def __init__(self, api_base_url: str = API_BASE_URL):
        self.api_base_url = api_base_url.rstrip('/')
        
    def encode_image_to_base64(self, image_path: str) -> Optional[str]:
        """Convert local image file to base64 string for API upload."""
        try:
            with open(image_path, 'rb') as f:
                image_data = f.read()
                return base64.b64encode(image_data).decode('utf-8')
        except Exception as e:
            print(f"❌ Failed to encode image {image_path}: {e}")
            return None
    
    def upload_single_point(self, location_data: Dict[str, Any]) -> bool:
        """Upload a single location point to the heatmap API."""
        try:
            # Extract required data
            address = location_data.get('address')
            image_path = location_data.get('image_path')
            beauty_score = location_data.get('beauty_score')
            aesthetic_review = location_data.get('aesthetic_review')
            
            if not all([address, image_path, beauty_score]):
                print(f"⚠️  Skipping incomplete location: {address}")
                return False
            
            # Check if image file exists
            if not Path(image_path).exists():
                print(f"⚠️  Image file not found: {image_path}")
                return False
            
            # Encode image to base64
            image_base64 = self.encode_image_to_base64(image_path)
            if not image_base64:
                return False
            
            # Prepare API payload
            payload = {
                'address': address,
                'imageData': image_base64,  # Send as base64 data instead of URL
                'precomputedBeauty': beauty_score,
                'precomputedReview': aesthetic_review
            }
            
            # Make API request
            response = requests.post(
                f'{self.api_base_url}/point',
                json=payload,
                timeout=30
            )
            
            if response.status_code in [200, 201]:
                result = response.json()
                if response.status_code == 200 and result.get('message'):
                    # Location already exists (duplicate detected by Place ID)
                    print(f"⚠️  Skipped duplicate: {address} (Score: {result['point']['beauty']}/10)")
                    return True  # Consider this a successful operation
                else:
                    print(f"✅ Uploaded: {address} (Score: {beauty_score}/10)")
                    return True
            else:
                error_data = response.json() if response.headers.get('content-type', '').startswith('application/json') else {}
                print(f"❌ Failed to upload {address}: {response.status_code} - {error_data.get('error', 'Unknown error')}")
                return False
                
        except Exception as e:
            print(f"❌ Error uploading {location_data.get('address', 'unknown')}: {e}")
            return False
    
    def upload_from_cache(self, cache_file: str = 'location_cache.json') -> Dict[str, int]:
        """Upload all evaluated locations from the cache file."""
        stats = {'uploaded': 0, 'skipped': 0, 'failed': 0}
        
        try:
            if not Path(cache_file).exists():
                print(f"❌ Cache file not found: {cache_file}")
                return stats
            
            with open(cache_file, 'r') as f:
                cache_data = json.load(f)
            
            # Filter locations that have beauty scores
            evaluated_locations = []
            for place_id, location_data in cache_data.items():
                if location_data.get('beauty_score') is not None:
                    evaluated_locations.append(location_data)
            
            print(f"🎯 Found {len(evaluated_locations)} evaluated locations in cache")
            
            if not evaluated_locations:
                print("ℹ️  No evaluated locations found. Run some AI evaluations first!")
                return stats
            
            # Upload in batches
            for i in range(0, len(evaluated_locations), MAX_BATCH_SIZE):
                batch = evaluated_locations[i:i + MAX_BATCH_SIZE]
                print(f"\n📦 Processing batch {i//MAX_BATCH_SIZE + 1} ({len(batch)} locations)...")
                
                for location_data in batch:
                    if self.upload_single_point(location_data):
                        stats['uploaded'] += 1
                    else:
                        stats['failed'] += 1
                
                # Small delay between batches
                if i + MAX_BATCH_SIZE < len(evaluated_locations):
                    import time
                    time.sleep(1)
            
            return stats
            
        except Exception as e:
            print(f"❌ Error processing cache file: {e}")
            return stats
    
    def upload_recent_evaluations(self, count: int = 10) -> Dict[str, int]:
        """Upload the most recent N evaluated locations."""
        stats = {'uploaded': 0, 'skipped': 0, 'failed': 0}
        
        try:
            with open('location_cache.json', 'r') as f:
                cache_data = json.load(f)
            
            # Get locations with beauty scores, sorted by date
            evaluated_locations = []
            for place_id, location_data in cache_data.items():
                if (location_data.get('beauty_score') is not None and 
                    location_data.get('cached_date')):
                    evaluated_locations.append(location_data)
            
            # Sort by cached_date (most recent first)
            evaluated_locations.sort(
                key=lambda x: x.get('cached_date', ''), 
                reverse=True
            )
            
            # Take the most recent N
            recent_locations = evaluated_locations[:count]
            
            print(f"🎯 Uploading {len(recent_locations)} most recent evaluations...")
            
            for location_data in recent_locations:
                if self.upload_single_point(location_data):
                    stats['uploaded'] += 1
                else:
                    stats['failed'] += 1
            
            return stats
            
        except Exception as e:
            print(f"❌ Error uploading recent evaluations: {e}")
            return stats
    
    def test_api_connection(self) -> bool:
        """Test if the API is accessible."""
        try:
            response = requests.get(f'{self.api_base_url}/stats', timeout=10)
            if response.status_code == 200:
                stats = response.json()
                print(f"✅ API connection successful!")
                print(f"   Current heatmap stats: {stats.get('total_points', 0)} points, avg beauty: {stats.get('avg_beauty', 'N/A')}")
                return True
            else:
                print(f"❌ API connection failed: {response.status_code}")
                return False
        except Exception as e:
            print(f"❌ API connection error: {e}")
            return False


def main():
    """Main function with command-line interface."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Upload London beauty data to live heatmap')
    parser.add_argument('--api-url', default=API_BASE_URL, help='Heatmap API base URL')
    parser.add_argument('--test', action='store_true', help='Test API connection only')
    parser.add_argument('--recent', type=int, metavar='N', help='Upload N most recent evaluations')
    parser.add_argument('--all', action='store_true', help='Upload all evaluated locations from cache')
    parser.add_argument('--cache-file', default='location_cache.json', help='Path to cache file')
    
    args = parser.parse_args()
    
    uploader = HeatmapUploader(args.api_url)
    
    if args.test:
        uploader.test_api_connection()
        return
    
    if args.recent:
        print(f"🚀 Uploading {args.recent} most recent evaluations...")
        stats = uploader.upload_recent_evaluations(args.recent)
    elif args.all:
        print("🚀 Uploading all evaluated locations...")
        stats = uploader.upload_from_cache(args.cache_file)
    else:
        print("🚀 Uploading 5 most recent evaluations (default)...")
        stats = uploader.upload_recent_evaluations(5)
    
    print(f"\n📊 UPLOAD SUMMARY:")
    print(f"   ✅ Uploaded: {stats['uploaded']}")
    print(f"   ❌ Failed: {stats['failed']}")
    print(f"   📊 Total processed: {stats['uploaded'] + stats['failed']}")
    
    if stats['uploaded'] > 0:
        print(f"\n🌐 Check your heatmap at: https://your-domain.pages.dev")


if __name__ == "__main__":
    main()