"""London coordinate generation for random sampling."""

import random
from typing import Tuple


# London boundaries (approximate)
LONDON_BOUNDS = {
    'north': 51.7,    # North London
    'south': 51.3,    # South London  
    'east': 0.2,      # East London
    'west': -0.5      # West London
}


def generate_random_london_coordinates() -> Tuple[float, float]:
    """Generate random coordinates within London boundaries.
    
    Returns:
        Tuple of (latitude, longitude)
    """
    lat = random.uniform(LONDON_BOUNDS['south'], LONDON_BOUNDS['north'])
    lng = random.uniform(LONDON_BOUNDS['west'], LONDON_BOUNDS['east'])
    return lat, lng


def generate_grid_coordinates(grid_size: int = 10) -> list[Tuple[float, float]]:
    """Generate coordinates in a grid pattern across London.
    
    Args:
        grid_size: Number of points per side of the grid
        
    Returns:
        List of (latitude, longitude) tuples
    """
    coordinates = []
    lat_step = (LONDON_BOUNDS['north'] - LONDON_BOUNDS['south']) / grid_size
    lng_step = (LONDON_BOUNDS['east'] - LONDON_BOUNDS['west']) / grid_size
    
    for i in range(grid_size):
        for j in range(grid_size):
            # Add some randomness to avoid perfect grid
            lat = LONDON_BOUNDS['south'] + (i + random.uniform(0.2, 0.8)) * lat_step
            lng = LONDON_BOUNDS['west'] + (j + random.uniform(0.2, 0.8)) * lng_step
            coordinates.append((lat, lng))
    
    return coordinates


def coordinates_to_address_string(lat: float, lng: float) -> str:
    """Convert coordinates to address string for API.
    
    Args:
        lat: Latitude
        lng: Longitude
        
    Returns:
        Formatted coordinate string for geocoding
    """
    return f"{lat:.6f},{lng:.6f}"