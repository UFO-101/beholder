"""Street View image downloading utilities."""

import math
import uuid
from pathlib import Path
from typing import Optional, Tuple

import requests
from PIL import Image
import hashlib


def is_blank_street_view_image(image_path: str) -> bool:
    """Check if a Street View image is blank (no imagery available).
    
    Google Street View returns a standard blank image with "Sorry, we have no imagery here"
    when no Street View coverage is available for the requested location.
    
    Args:
        image_path: Path to the downloaded Street View image
        
    Returns:
        True if the image is blank/no imagery, False otherwise
    """
    try:
        img = Image.open(image_path)
        
        # Convert to RGB if needed
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        # Get image hash to detect standard "no imagery" image
        # Google's blank images have consistent patterns
        img_bytes = img.tobytes()
        img_hash = hashlib.md5(img_bytes).hexdigest()
        
        # Known hashes for Google's "no imagery" images (these are consistent)
        # These may need updating if Google changes their blank image format
        blank_image_indicators = [
            # Check for predominantly gray/white images (typical of "no imagery")
            # Also check image dimensions and basic pixel analysis
        ]
        
        # Alternative approach: Check for predominantly uniform colors
        # Get a sample of pixels from the image
        width, height = img.size
        sample_size = min(100, width * height // 100)  # Sample ~1% of pixels
        
        pixels = []
        step_x = max(1, width // 10)
        step_y = max(1, height // 10)
        
        for y in range(0, height, step_y):
            for x in range(0, width, step_x):
                if len(pixels) >= sample_size:
                    break
                pixels.append(img.getpixel((x, y)))
            if len(pixels) >= sample_size:
                break
        
        if not pixels:
            return False
        
        # Calculate color variance - blank images tend to be very uniform
        avg_r = sum(p[0] for p in pixels) / len(pixels)
        avg_g = sum(p[1] for p in pixels) / len(pixels)
        avg_b = sum(p[2] for p in pixels) / len(pixels)
        
        variance_r = sum((p[0] - avg_r) ** 2 for p in pixels) / len(pixels)
        variance_g = sum((p[1] - avg_g) ** 2 for p in pixels) / len(pixels)
        variance_b = sum((p[2] - avg_b) ** 2 for p in pixels) / len(pixels)
        
        total_variance = variance_r + variance_g + variance_b
        
        # Blank images typically have very low variance and grayish colors
        is_low_variance = total_variance < 100  # Very uniform
        is_grayish = (
            abs(avg_r - avg_g) < 20 and 
            abs(avg_g - avg_b) < 20 and 
            abs(avg_r - avg_b) < 20 and
            200 <= avg_r <= 255  # Light gray/white range
        )
        
        return is_low_variance and is_grayish
        
    except Exception as e:
        print(f"Error checking if image is blank: {e}")
        return False


def get_street_view_metadata(api_key: str, lat: float, lon: float) -> Optional[dict]:
    """Get Street View metadata including panorama location.
    
    Args:
        api_key: Google Maps API key
        lat: Target latitude
        lon: Target longitude
        
    Returns:
        Metadata dictionary if panorama found, None otherwise
    """
    try:
        base_url = "https://maps.googleapis.com/maps/api/streetview/metadata"
        params = {
            "location": f"{lat},{lon}",
            "key": api_key
        }
        
        response = requests.get(base_url, params=params)
        if response.status_code == 200:
            metadata = response.json()
            if metadata.get("status") == "OK":
                return metadata
        return None
    except Exception as e:
        print(f"Error getting Street View metadata: {e}")
        return None


def calculate_heading(from_lat: float, from_lon: float, to_lat: float, to_lon: float) -> float:
    """Calculate heading from one point to another.
    
    Args:
        from_lat: Starting latitude
        from_lon: Starting longitude  
        to_lat: Target latitude
        to_lon: Target longitude
        
    Returns:
        Heading in degrees (0-360)
    """
    # Convert to radians
    lat1 = math.radians(from_lat)
    lat2 = math.radians(to_lat) 
    delta_lon = math.radians(to_lon - from_lon)
    
    # Calculate heading
    y = math.sin(delta_lon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(delta_lon)
    
    heading = math.atan2(y, x)
    heading = math.degrees(heading)
    heading = (heading + 360) % 360  # Normalize to 0-360
    
    return heading


def get_optimal_street_view_params(
    api_key: str, target_lat: float, target_lon: float
) -> Tuple[float, float, Optional[float]]:
    """Get optimal Street View parameters like Google Maps does.
    
    Args:
        api_key: Google Maps API key
        target_lat: Target address latitude
        target_lon: Target address longitude
        
    Returns:
        Tuple of (panorama_lat, panorama_lon, optimal_heading)
    """
    # Get Street View metadata to find actual panorama location
    metadata = get_street_view_metadata(api_key, target_lat, target_lon)
    
    if metadata and metadata.get("location"):
        pano_location = metadata["location"]
        pano_lat = pano_location["lat"]
        pano_lon = pano_location["lng"]
        
        # Calculate heading from panorama to target
        heading = calculate_heading(pano_lat, pano_lon, target_lat, target_lon)
        
        return pano_lat, pano_lon, heading
    else:
        # Fallback to target location if no panorama found
        return target_lat, target_lon, None


def get_street_view_image_url(
    api_key: str, 
    lat: float, 
    lon: float, 
    size: str = "640x640", 
    fov: int = 90,
    outdoor_only: bool = True,
    heading: Optional[float] = None
) -> str:
    """Generate Street View Static API URL for given coordinates.
    
    Args:
        api_key: Google Maps API key
        lat: Latitude
        lon: Longitude
        size: Image size in format "widthxheight" (default: "640x640")
        fov: Field of view in degrees (default: 90)
        outdoor_only: If True, prefer official Google Street View over user photospheres
        heading: Camera heading in degrees (0-360). If None, API will auto-calculate
        
    Returns:
        Complete Street View Static API URL
    """
    base_url = "https://maps.googleapis.com/maps/api/streetview"
    params = {"size": size, "location": f"{lat},{lon}", "fov": fov, "key": api_key}
    
    if outdoor_only:
        # Add source parameter to prefer official Google Street View imagery
        params["source"] = "outdoor"
    
    if heading is not None:
        params["heading"] = str(heading)

    # Build URL with parameters
    param_string = "&".join([f"{key}={value}" for key, value in params.items()])
    return f"{base_url}?{param_string}"


def download_street_view_image(
    api_key: str, 
    lat: float, 
    lon: float, 
    save_path: Optional[str] = None,
    images_dir: str = "images",
    outdoor_only: bool = True,
    optimize_viewpoint: bool = True
) -> Optional[str]:
    """Download Street View image and save it locally.
    
    Args:
        api_key: Google Maps API key
        lat: Target latitude (address location)
        lon: Target longitude (address location)
        save_path: Optional specific path to save the image
        images_dir: Directory to save images in (default: "images")
        outdoor_only: If True, prefer official Google Street View over user photospheres
        optimize_viewpoint: If True, use Google Maps-style optimal viewpoint calculation
        
    Returns:
        Path to saved image file if successful, None otherwise
    """
    try:
        if optimize_viewpoint:
            # Get optimal Street View parameters like Google Maps does
            pano_lat, pano_lon, heading = get_optimal_street_view_params(api_key, lat, lon)
            url = get_street_view_image_url(
                api_key, pano_lat, pano_lon, 
                outdoor_only=outdoor_only, 
                heading=heading
            )
        else:
            # Use target coordinates directly (old behavior)
            url = get_street_view_image_url(api_key, lat, lon, outdoor_only=outdoor_only)
            pano_lat, pano_lon = lat, lon

        response = requests.get(url)

        if response.status_code == 200:
            # Create images directory if it doesn't exist
            images_path = Path(images_dir)
            images_path.mkdir(exist_ok=True)

            # Generate filename if not provided
            if save_path is None:
                filename = f"streetview_{pano_lat:.6f}_{pano_lon:.6f}_{uuid.uuid4().hex[:8]}.jpg"
                save_path = images_path / filename
            else:
                save_path = Path(save_path)

            # Save the image
            with open(save_path, "wb") as f:
                f.write(response.content)
            
            # Check if the image is blank (no Street View coverage)
            if is_blank_street_view_image(str(save_path)):
                print(f"⚠️  No Street View imagery available at ({lat:.6f}, {lon:.6f})")
                return None

            return str(save_path)
        else:
            print(f"Failed to download Street View image: HTTP {response.status_code}")
            return None

    except Exception as e:
        print(f"Error downloading Street View image for ({lat}, {lon}): {e}")
        return None


def download_street_view_comparison(
    api_key: str,
    lat: float,
    lon: float,
    images_dir: str = "images",
    outdoor_only: bool = True
) -> dict:
    """Download both old and new method Street View images for comparison.
    
    Args:
        api_key: Google Maps API key
        lat: Target latitude (address location)
        lon: Target longitude (address location)
        images_dir: Directory to save images in (default: "images")
        outdoor_only: If True, prefer official Google Street View over user photospheres
        
    Returns:
        Dictionary with old_image_path, new_image_path, and metadata
    """
    try:
        # Create images directory if it doesn't exist
        images_path = Path(images_dir)
        images_path.mkdir(exist_ok=True)
        
        base_filename = f"streetview_{lat:.6f}_{lon:.6f}_{uuid.uuid4().hex[:8]}"
        
        # Method 1: Old method (API auto-calculates heading)
        old_url = get_street_view_image_url(api_key, lat, lon, outdoor_only=outdoor_only)
        old_response = requests.get(old_url)
        old_image_path = None
        
        if old_response.status_code == 200:
            old_image_path = images_path / f"{base_filename}_old.jpg"
            with open(old_image_path, "wb") as f:
                f.write(old_response.content)
            old_image_path = str(old_image_path)
        
        # Method 2: New method (we calculate optimal parameters)
        pano_lat, pano_lon, heading = get_optimal_street_view_params(api_key, lat, lon)
        new_url = get_street_view_image_url(
            api_key, pano_lat, pano_lon, 
            outdoor_only=outdoor_only, 
            heading=heading
        )
        new_response = requests.get(new_url)
        new_image_path = None
        
        if new_response.status_code == 200:
            new_image_path = images_path / f"{base_filename}_new.jpg"
            with open(new_image_path, "wb") as f:
                f.write(new_response.content)
            new_image_path = str(new_image_path)
        
        return {
            "old_image_path": old_image_path,
            "new_image_path": new_image_path,
            "old_url": old_url,
            "new_url": new_url,
            "target_coords": (lat, lon),
            "panorama_coords": (pano_lat, pano_lon),
            "calculated_heading": heading
        }
        
    except Exception as e:
        print(f"Error downloading comparison images for ({lat}, {lon}): {e}")
        return {
            "old_image_path": None,
            "new_image_path": None,
            "error": str(e)
        }