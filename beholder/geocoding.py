"""Geocoding utilities for address resolution and filtering."""

import re
from typing import Optional

import googlemaps


def create_gmaps_client(api_key: str) -> googlemaps.Client:
    """Create and return a Google Maps client.
    
    Args:
        api_key: Google Maps API key
        
    Returns:
        Configured Google Maps client
    """
    return googlemaps.Client(key=api_key)


def has_plus_code(formatted_address: str) -> bool:
    """Check if the address is a Plus Code.
    
    Args:
        formatted_address: The formatted address string
        
    Returns:
        True if the address contains a Plus Code pattern
    """
    # Plus codes have pattern like "XXXX+XX"
    plus_code_pattern = r"[A-Z0-9]{4}\+[A-Z0-9]{2,3}"
    return bool(re.search(plus_code_pattern, formatted_address))


def is_building_address(address_components: list) -> bool:
    """Check if the address represents a building/establishment rather than a general area.
    
    Args:
        address_components: List of address components from Google Maps API
        
    Returns:
        True if the address likely represents a specific building
    """
    types_to_exclude = {
        "plus_code",
        "neighborhood",
        "sublocality",
        "locality",
        "administrative_area_level_1",
        "administrative_area_level_2",
        "country",
        "postal_code",
        "natural_feature",
        "park",
    }

    # Look for street number (indicates a specific building)
    has_street_number = any(
        "street_number" in component.get("types", [])
        for component in address_components
    )

    # Check if it's mainly administrative/area types
    main_types = set()
    for component in address_components:
        main_types.update(component.get("types", []))

    # If it has a street number, it's likely a building
    if has_street_number:
        return True

    # If it's mainly administrative areas, it's not a specific building
    if main_types.issubset(types_to_exclude):
        return False

    return True


def get_nearest_building_address(
    gmaps_client: googlemaps.Client, lat: float, lon: float
) -> Optional[str]:
    """Get the nearest building address, filtering out Plus Codes and general areas.
    
    Args:
        gmaps_client: Google Maps client
        lat: Latitude
        lon: Longitude
        
    Returns:
        Formatted address string if found, None otherwise
    """
    try:
        results = gmaps_client.reverse_geocode((lat, lon))

        for result in results:
            formatted_address = result["formatted_address"]
            address_components = result["address_components"]

            # Skip Plus Codes
            if has_plus_code(formatted_address):
                continue

            # Skip non-building addresses
            if not is_building_address(address_components):
                continue

            return formatted_address

        # If no building found, return the first non-Plus Code address
        for result in results:
            formatted_address = result["formatted_address"]
            if not has_plus_code(formatted_address):
                return formatted_address

        return None
    except Exception as e:
        print(f"Error getting address for ({lat}, {lon}): {e}")
        return None


def get_location_details(
    gmaps_client: googlemaps.Client, lat: float, lon: float, verbose: bool = False
) -> Optional[dict]:
    """Get comprehensive location details including Place ID, address, and coordinates.
    
    Args:
        gmaps_client: Google Maps client
        lat: Latitude
        lon: Longitude
        verbose: If True, print detailed logging information
        
    Returns:
        Dictionary with place_id, address, formatted_address, coordinates, and metadata
    """
    try:
        if verbose:
            print(f"   🔍 Getting location details for ({lat:.6f}, {lon:.6f})")
            
        results = gmaps_client.reverse_geocode((lat, lon))
        
        if not results:
            if verbose:
                print(f"   ❌ No geocoding results found")
            return None

        # Find the best result (building address)
        best_result = None
        
        for result in results:
            formatted_address = result["formatted_address"]
            address_components = result["address_components"]

            # Skip Plus Codes
            if has_plus_code(formatted_address):
                continue

            # Prefer building addresses
            if is_building_address(address_components):
                best_result = result
                break

        # If no building found, use the first non-Plus Code result
        if not best_result:
            for result in results:
                formatted_address = result["formatted_address"]
                if not has_plus_code(formatted_address):
                    best_result = result
                    break

        if not best_result:
            if verbose:
                print(f"   ❌ No suitable address found")
            return None

        # Extract details from the best result
        place_id = best_result.get('place_id')
        formatted_address = best_result['formatted_address']
        geometry = best_result.get('geometry', {})
        location = geometry.get('location', {})
        
        location_details = {
            'place_id': place_id,
            'address': formatted_address,
            'coordinates': {
                'lat': location.get('lat', lat),
                'lng': location.get('lng', lon)
            },
            'location_type': geometry.get('location_type', 'UNKNOWN'),
            'address_components': best_result.get('address_components', []),
            'types': best_result.get('types', [])
        }
        
        if verbose:
            print(f"   ✅ Location details found:")
            print(f"      Place ID: {place_id}")
            print(f"      Address: {formatted_address}")
            print(f"      Type: {location_details['location_type']}")
            
        return location_details
        
    except Exception as e:
        if verbose:
            print(f"   ❌ Error getting location details: {e}")
        else:
            print(f"Error getting location details for ({lat}, {lon}): {e}")
        return None


def get_nearest_address(
    gmaps_client: googlemaps.Client, lat: float, lon: float
) -> Optional[str]:
    """Get the nearest address for given coordinates using Google Maps reverse geocoding.
    
    Args:
        gmaps_client: Google Maps client
        lat: Latitude
        lon: Longitude
        
    Returns:
        Formatted address string if found, None otherwise
    """
    return get_nearest_building_address(gmaps_client, lat, lon)


def get_coordinates_from_address(
    gmaps_client: googlemaps.Client, address: str, verbose: bool = False
) -> Optional[tuple[float, float]]:
    """Get coordinates for a given address using forward geocoding.
    
    Args:
        gmaps_client: Google Maps client
        address: Address string to geocode
        verbose: If True, print detailed logging information
        
    Returns:
        Tuple of (latitude, longitude) if found, None otherwise
    """
    try:
        if verbose:
            print(f"   🔍 Forward geocoding: '{address}'")
            
        results = gmaps_client.geocode(address)
        
        if results and len(results) > 0:
            location = results[0]['geometry']['location']
            lat, lng = location['lat'], location['lng']
            
            if verbose:
                print(f"   ✅ Forward geocoding success: ({lat:.6f}, {lng:.6f})")
                print(f"   📋 Result type: {results[0].get('geometry', {}).get('location_type', 'Unknown')}")
                
            return lat, lng
        else:
            if verbose:
                print(f"   ❌ Forward geocoding failed: No results found")
            return None
            
    except Exception as e:
        if verbose:
            print(f"   ❌ Forward geocoding error: {e}")
        else:
            print(f"Error geocoding address '{address}': {e}")
        return None