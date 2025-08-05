"""Coordinate generation utilities for London sampling."""

import random
from typing import Tuple


def generate_random_london_coordinates() -> Tuple[float, float]:
    """Generate random coordinates within central London's bounding box.
    
    Returns:
        Tuple of (latitude, longitude) within central London (approximately Zone 1-3)
    """
    # Central London bounding box (Zone 1-3 approximately)
    lat_min, lat_max = 51.45, 51.55
    lon_min, lon_max = -0.25, 0.05

    latitude = random.uniform(lat_min, lat_max)
    longitude = random.uniform(lon_min, lon_max)

    return latitude, longitude


def generate_random_coordinates_in_bounds(
    lat_min: float, lat_max: float, lon_min: float, lon_max: float
) -> Tuple[float, float]:
    """Generate random coordinates within specified bounds.
    
    Args:
        lat_min: Minimum latitude
        lat_max: Maximum latitude
        lon_min: Minimum longitude
        lon_max: Maximum longitude
        
    Returns:
        Tuple of (latitude, longitude)
    """
    latitude = random.uniform(lat_min, lat_max)
    longitude = random.uniform(lon_min, lon_max)
    return latitude, longitude