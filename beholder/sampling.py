"""Main sampling functions for London location data collection."""

import os
import time
from typing import Any, Dict, List

from dotenv import load_dotenv

from .coordinates import generate_random_london_coordinates
from .geocoding import (
    create_gmaps_client,
    get_coordinates_from_address,
    get_nearest_address,
    get_location_details,
)
from .location_cache import get_location_cache
from .streetview import download_street_view_image, download_street_view_comparison
from .aesthetic_evaluation import get_aesthetic_evaluator

load_dotenv()


def sample_london_location(
    verbose: bool = True, 
    outdoor_only: bool = True, 
    optimize_viewpoint: bool = True,
    use_cache: bool = True,
    evaluate_aesthetics: bool = False,
    max_retries: int = 3
) -> Dict[str, Any]:
    """Sample a random location in London and get its address and Street View image.

    Args:
        verbose: If True, print detailed logging information
        outdoor_only: If True, prefer official Google Street View over user photospheres
        optimize_viewpoint: If True, use Google Maps-style optimal viewpoint calculation
        use_cache: If True, use Place ID caching to avoid duplicate work
        evaluate_aesthetics: If True, analyze the image with Gemini for beauty scoring
        max_retries: Maximum number of retries if Street View imagery is not available

    Returns:
        Dictionary containing latitude, longitude, address, place_id, image_path, and optionally beauty data

    Raises:
        ValueError: If GOOGLE_MAPS_API_KEY environment variable is not set
    """
    api_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_MAPS_API_KEY environment variable is required")

    gmaps_client = create_gmaps_client(api_key)
    cache = get_location_cache() if use_cache else None

    for attempt in range(max_retries):
        if verbose and attempt > 0:
            print(f"🔄 Retry attempt {attempt + 1}/{max_retries}")

        # Step 1: Generate random coordinates
        random_lat, random_lon = generate_random_london_coordinates()
        if verbose:
            print(f"🎯 Step 1: Generated random coordinates: ({random_lat:.6f}, {random_lon:.6f})")

        # Step 2: Get comprehensive location details (including Place ID)
        location_details = get_location_details(gmaps_client, random_lat, random_lon, verbose)
        
        if not location_details:
            if verbose:
                print("❌ Step 2: No location details found")
            continue  # Try again with new coordinates

        place_id = location_details['place_id']
        address = location_details['address']
        coords = location_details['coordinates']
        address_lat, address_lon = coords['lat'], coords['lng']

        if verbose:
            print(f"🏠 Step 2: Found location: {address}")
            print(f"🆔 Place ID: {place_id}")

        # Step 3: Check cache for existing analysis
        cached_location = None
        if cache and place_id:
            cached_location = cache.get_location(place_id)
            if cached_location and not cache.is_stale(place_id):
                if verbose:
                    print(f"💾 Step 3: Found cached location data")
                    if cached_location.get('beauty_score'):
                        print(f"⭐ Cached beauty score: {cached_location['beauty_score']}")
                    print(f"🖼️  Cached image: {cached_location.get('image_path', 'N/A')}")
                    print("-" * 60)
                
                # Return cached data but update with current sampling info
                result = cached_location.copy()
                result.update({
                    "random_latitude": random_lat,
                    "random_longitude": random_lon,
                    "from_cache": True
                })
                
                # If aesthetic evaluation requested but not cached, analyze now
                if evaluate_aesthetics and not result.get('beauty_score'):
                    if verbose:
                        print(f"🎨 Step 4: Performing aesthetic evaluation on cached location")
                    
                    try:
                        evaluator = get_aesthetic_evaluator()
                        aesthetic_result = evaluator.analyze_image(
                            result['image_path'], 
                            result['address'],
                            verbose=verbose
                        )
                        
                        # Update both result and cache with aesthetic data
                        result.update({
                            'aesthetic_review': aesthetic_result.get('aesthetic_review'),
                            'beauty_score': aesthetic_result.get('beauty_score'),
                            'analysis_time': aesthetic_result.get('analysis_time')
                        })
                        
                        # Update cache with aesthetic data
                        cache.update_location(
                            place_id,
                            aesthetic_review=aesthetic_result.get('aesthetic_review'),
                            beauty_score=aesthetic_result.get('beauty_score'),
                            analysis_time=aesthetic_result.get('analysis_time')
                        )
                        
                        if verbose:
                            print(f"   ⭐ Beauty score: {result.get('beauty_score', 'N/A')}")
                            print(f"   💾 Updated cache with aesthetic data")
                    
                    except Exception as e:
                        if verbose:
                            print(f"   ❌ Aesthetic evaluation failed: {e}")
                        result.update({
                            'aesthetic_review': None,
                            'beauty_score': None,
                            'aesthetic_error': str(e)
                        })
                
                return result

        # Step 4: Location not in cache or stale, process normally
        if verbose:
            if cached_location:
                print(f"🔄 Step 3: Cached data is stale, refreshing...")
            else:
                print(f"🆕 Step 3: New location, processing...")

        distance = ((address_lat - random_lat) ** 2 + (address_lon - random_lon) ** 2) ** 0.5
        if verbose:
            print(f"✅ Step 3: Address coordinates: ({address_lat:.6f}, {address_lon:.6f})")
            print(f"📏 Distance from random coords: {distance:.6f} degrees (~{distance * 111000:.0f}m)")

        # Step 5: Download Street View image
        if verbose:
            print(f"📸 Step 4: Downloading Street View image")
        
        image_path = download_street_view_image(
            api_key, address_lat, address_lon, 
            outdoor_only=outdoor_only, 
            optimize_viewpoint=optimize_viewpoint
        )
        
        # If no image was downloaded (blank/no imagery), try again
        if image_path is None:
            if verbose:
                print(f"⚠️  No Street View imagery available, trying new location...")
            continue
        
        # Successfully got an image, break out of retry loop
        break
    
    else:
        # All retries failed
        if verbose:
            print(f"❌ Failed to find location with Street View imagery after {max_retries} attempts")
        return None

    # Step 6: Perform aesthetic evaluation if requested
    aesthetic_review = None
    beauty_score = None
    analysis_time = None
    
    if evaluate_aesthetics and image_path:
        if verbose:
            print(f"🎨 Step 5: Performing aesthetic evaluation")
        
        try:
            evaluator = get_aesthetic_evaluator()
            aesthetic_result = evaluator.analyze_image(
                image_path, address, verbose=verbose
            )
            
            aesthetic_review = aesthetic_result.get('aesthetic_review')
            beauty_score = aesthetic_result.get('beauty_score')
            analysis_time = aesthetic_result.get('analysis_time')
            
        except Exception as e:
            if verbose:
                print(f"   ❌ Aesthetic evaluation failed: {e}")
            aesthetic_review = None
            beauty_score = None

    # Step 7: Cache the location data
    result = {
        "place_id": place_id,
        "latitude": address_lat,
        "longitude": address_lon,
        "random_latitude": random_lat,
        "random_longitude": random_lon,
        "address": address,
        "image_path": image_path,
        "location_type": location_details.get('location_type'),
        "streetview_coords_used": "address",
        "from_cache": False,
        "aesthetic_review": aesthetic_review,
        "beauty_score": beauty_score,
        "analysis_time": analysis_time
    }

    if cache and place_id:
        cache.add_location(
            place_id=place_id,
            address=address,
            coordinates=coords,
            image_path=image_path,
            location_type=location_details.get('location_type'),
            types=location_details.get('types', []),
            aesthetic_review=aesthetic_review,
            beauty_score=beauty_score,
            analysis_time=analysis_time
        )
        if verbose:
            print(f"💾 Cached location data for future use")

    if verbose:
        print(f"🖼️  Final result: New location processed")
        print(f"💾 Image saved: {image_path}")
        if beauty_score:
            print(f"⭐ Beauty score: {beauty_score}")
        print("-" * 60)

    return result


def sample_multiple_locations(count: int, comparison_mode: bool = False, **kwargs) -> List[Dict[str, Any]]:
    """Sample multiple random locations in London.

    Args:
        count: Number of locations to sample
        comparison_mode: If True, generate both old and new method images for comparison
        **kwargs: Additional arguments passed to sample_london_location

    Returns:
        List of location dictionaries (with comparison data if comparison_mode=True)
    """
    if comparison_mode:
        return [sample_london_location_with_comparison(**kwargs) for _ in range(count)]
    else:
        return [sample_london_location(**kwargs) for _ in range(count)]


def sample_london_location_with_comparison(
    verbose: bool = True, 
    outdoor_only: bool = True
) -> Dict[str, Any]:
    """Sample a London location and generate both old/new method Street View images.
    
    Args:
        verbose: If True, print detailed logging information
        outdoor_only: If True, prefer official Google Street View over user photospheres
        
    Returns:
        Dictionary with location data and both old/new images
    """
    api_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_MAPS_API_KEY environment variable is required")

    gmaps_client = create_gmaps_client(api_key)
    
    # Step 1: Generate random coordinates
    random_lat, random_lon = generate_random_london_coordinates()
    if verbose:
        print(f"🎯 Step 1: Generated random coordinates: ({random_lat:.6f}, {random_lon:.6f})")
    
    # Step 2: Find nearest address
    address = get_nearest_address(gmaps_client, random_lat, random_lon)
    if verbose:
        if address:
            print(f"🏠 Step 2: Found nearest address: {address}")
        else:
            print("❌ Step 2: No address found for random coordinates")
    
    if address:
        # Step 3: Get precise address coordinates
        if verbose:
            print(f"📍 Step 3: Forward geocoding address to get precise coordinates...")
        
        address_coords = get_coordinates_from_address(gmaps_client, address, verbose)
        
        if address_coords:
            address_lat, address_lon = address_coords
            distance = ((address_lat - random_lat)**2 + (address_lon - random_lon)**2)**0.5
            
            if verbose:
                print(f"✅ Step 3: Address coordinates: ({address_lat:.6f}, {address_lon:.6f})")
                print(f"📏 Distance from random coords: {distance:.6f} degrees (~{distance * 111000:.0f}m)")
            
            # Step 4: Download comparison images
            if verbose:
                print(f"📸 Step 4: Downloading BOTH old and new method Street View images")
            
            comparison_data = download_street_view_comparison(
                api_key, address_lat, address_lon, outdoor_only=outdoor_only
            )
            
            if verbose:
                print(f"🖼️  Old method image: {comparison_data.get('old_image_path')}")
                print(f"🖼️  New method image: {comparison_data.get('new_image_path')}")
                if comparison_data.get('calculated_heading'):
                    print(f"🧭 Calculated heading: {comparison_data['calculated_heading']:.1f}°")
                print("-" * 60)
            
            return {
                "latitude": address_lat,
                "longitude": address_lon,
                "random_latitude": random_lat,
                "random_longitude": random_lon,
                "address": address,
                "old_image_path": comparison_data.get("old_image_path"),
                "new_image_path": comparison_data.get("new_image_path"),
                "comparison_data": comparison_data,
            }
        else:
            if verbose:
                print("❌ Step 3: Failed to geocode address")
            return None
    else:
        if verbose:
            print("❌ No address found, skipping comparison")
        return None


def sample_batch_locations(count: int, batch_size: int = 10, **kwargs) -> List[Dict[str, Any]]:
    """Sample locations in batches to avoid rate limiting.

    Args:
        count: Total number of locations to sample
        batch_size: Number of locations to sample per batch (default: 10)
        **kwargs: Additional arguments passed to sample_london_location

    Returns:
        List of all sampled location dictionaries
    """
    all_locations = []

    for i in range(0, count, batch_size):
        batch_count = min(batch_size, count - i)
        print(f"Sampling batch {i // batch_size + 1}: {batch_count} locations...")

        batch_locations = sample_multiple_locations(batch_count, **kwargs)
        all_locations.extend(batch_locations)

        # Add delay between batches to avoid rate limiting
        if i + batch_size < count:
            print("Waiting 2 seconds to avoid rate limiting...")
            time.sleep(2)

    return all_locations
