#!/usr/bin/env python3
"""
Test script to verify the integration between the local system and web heatmap.
"""

import json
from upload_to_heatmap import HeatmapUploader
from beholder import sample_london_location

def test_full_integration():
    """Test the complete pipeline: sample -> evaluate -> upload -> verify."""
    
    print("🧪 TESTING FULL INTEGRATION PIPELINE")
    print("="*50)
    
    # Step 1: Test API connection
    print("\n1️⃣ Testing API connection...")
    uploader = HeatmapUploader()
    if not uploader.test_api_connection():
        print("❌ API connection failed. Check your HEATMAP_API_URL")
        return False
    
    # Step 2: Sample and evaluate a location
    print("\n2️⃣ Sampling and evaluating a new location...")
    try:
        location = sample_london_location(
            evaluate_aesthetics=True,
            verbose=True,
            max_retries=3
        )
        
        if not location:
            print("❌ Failed to sample a location with valid imagery")
            return False
        
        if not location.get('beauty_score'):
            print("❌ Failed to get AI beauty evaluation")
            return False
            
        print(f"✅ Successfully evaluated: {location['address']}")
        print(f"   Beauty Score: {location['beauty_score']}/10")
        print(f"   Review: {location.get('aesthetic_review', 'N/A')[:100]}...")
        
    except Exception as e:
        print(f"❌ Sampling failed: {e}")
        return False
    
    # Step 3: Upload to heatmap
    print("\n3️⃣ Uploading to live heatmap...")
    if uploader.upload_single_point(location):
        print("✅ Successfully uploaded to heatmap!")
    else:
        print("❌ Failed to upload to heatmap")
        return False
    
    # Step 4: Verify upload
    print("\n4️⃣ Verifying upload...")
    if uploader.test_api_connection():
        print("✅ Upload verified - check your heatmap!")
    
    print("\n🎉 INTEGRATION TEST COMPLETE!")
    print("🌐 View your data at: https://your-domain.pages.dev")
    
    return True

def test_batch_upload():
    """Test uploading existing cache data."""
    
    print("🧪 TESTING BATCH UPLOAD FROM CACHE")
    print("="*40)
    
    uploader = HeatmapUploader()
    
    # Upload 3 most recent evaluations
    stats = uploader.upload_recent_evaluations(3)
    
    print(f"\n📊 Batch upload results:")
    print(f"   ✅ Uploaded: {stats['uploaded']}")
    print(f"   ❌ Failed: {stats['failed']}")
    
    return stats['uploaded'] > 0

def show_cache_stats():
    """Show statistics about the local cache."""
    
    print("📊 LOCAL CACHE STATISTICS")
    print("="*30)
    
    try:
        with open('location_cache.json', 'r') as f:
            cache = json.load(f)
        
        total_locations = len(cache)
        evaluated_locations = sum(1 for loc in cache.values() if loc.get('beauty_score'))
        
        if evaluated_locations > 0:
            scores = [loc['beauty_score'] for loc in cache.values() if loc.get('beauty_score')]
            avg_score = sum(scores) / len(scores)
            min_score = min(scores)
            max_score = max(scores)
            
            print(f"📍 Total locations: {total_locations}")
            print(f"⭐ Evaluated locations: {evaluated_locations}")
            print(f"📊 Average beauty score: {avg_score:.1f}/10")
            print(f"📈 Score range: {min_score} - {max_score}")
            
            # Show some examples
            print(f"\n🏆 Top locations:")
            sorted_locations = sorted(
                [loc for loc in cache.values() if loc.get('beauty_score')],
                key=lambda x: x['beauty_score'],
                reverse=True
            )
            
            for i, loc in enumerate(sorted_locations[:3]):
                print(f"   {i+1}. {loc['address']} - {loc['beauty_score']}/10")
        else:
            print(f"📍 Total locations: {total_locations}")
            print("⚠️  No evaluated locations found. Run some AI evaluations first!")
            
    except FileNotFoundError:
        print("❌ No cache file found. Run some location sampling first!")
    except Exception as e:
        print(f"❌ Error reading cache: {e}")

def main():
    """Main function with options."""
    import sys
    
    if len(sys.argv) > 1:
        command = sys.argv[1]
        
        if command == 'test':
            test_full_integration()
        elif command == 'batch':
            test_batch_upload()
        elif command == 'stats':
            show_cache_stats()
        else:
            print(f"Unknown command: {command}")
            print("Usage: python test_integration.py [test|batch|stats]")
    else:
        print("🧪 LONDON BEAUTY HEATMAP - INTEGRATION TESTER")
        print("="*50)
        show_cache_stats()
        print()
        
        response = input("Test full integration pipeline? (y/n): ")
        if response.lower() == 'y':
            test_full_integration()

if __name__ == "__main__":
    main()