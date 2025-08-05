"""Location cache system using Google Place IDs for deduplication."""

import json
import os
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime, timedelta


class LocationCache:
    """Cache for storing location analysis results using Google Place IDs."""
    
    def __init__(self, cache_file: str = "location_cache.json"):
        """Initialize the location cache.
        
        Args:
            cache_file: Path to the JSON cache file
        """
        self.cache_file = Path(cache_file)
        self._cache = self._load_cache()
    
    def _load_cache(self) -> Dict[str, Dict[str, Any]]:
        """Load cache from JSON file."""
        if self.cache_file.exists():
            try:
                with open(self.cache_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                print(f"Warning: Could not load cache file {self.cache_file}: {e}")
                return {}
        return {}
    
    def _save_cache(self) -> None:
        """Save cache to JSON file."""
        try:
            # Create parent directory if it doesn't exist
            self.cache_file.parent.mkdir(parents=True, exist_ok=True)
            
            with open(self.cache_file, 'w', encoding='utf-8') as f:
                json.dump(self._cache, f, indent=2, ensure_ascii=False)
        except IOError as e:
            print(f"Warning: Could not save cache file {self.cache_file}: {e}")
    
    def has_location(self, place_id: str) -> bool:
        """Check if a location is already cached.
        
        Args:
            place_id: Google Place ID
            
        Returns:
            True if location exists in cache
        """
        return place_id in self._cache
    
    def get_location(self, place_id: str) -> Optional[Dict[str, Any]]:
        """Get cached location data.
        
        Args:
            place_id: Google Place ID
            
        Returns:
            Cached location data or None if not found
        """
        return self._cache.get(place_id)
    
    def add_location(
        self, 
        place_id: str, 
        address: str,
        coordinates: Dict[str, float],
        **additional_data
    ) -> None:
        """Add a location to the cache.
        
        Args:
            place_id: Google Place ID
            address: Formatted address
            coordinates: Dict with 'lat' and 'lng' keys
            **additional_data: Additional data to store (beauty_score, review, etc.)
        """
        cache_entry = {
            'place_id': place_id,
            'address': address,
            'coordinates': coordinates,
            'cached_date': datetime.now().isoformat(),
            **additional_data
        }
        
        self._cache[place_id] = cache_entry
        self._save_cache()
    
    def update_location(self, place_id: str, **update_data) -> bool:
        """Update existing location data.
        
        Args:
            place_id: Google Place ID
            **update_data: Data to update
            
        Returns:
            True if location was updated, False if not found
        """
        if place_id not in self._cache:
            return False
        
        self._cache[place_id].update(update_data)
        self._cache[place_id]['updated_date'] = datetime.now().isoformat()
        self._save_cache()
        return True
    
    def is_stale(self, place_id: str, max_age_days: int = 365) -> bool:
        """Check if cached location data is stale.
        
        Google recommends refreshing Place IDs after 12 months.
        
        Args:
            place_id: Google Place ID
            max_age_days: Maximum age in days before considering stale
            
        Returns:
            True if data is stale or not found
        """
        if place_id not in self._cache:
            return True
        
        cached_date_str = self._cache[place_id].get('cached_date')
        if not cached_date_str:
            return True
        
        try:
            cached_date = datetime.fromisoformat(cached_date_str)
            age = datetime.now() - cached_date
            return age.days > max_age_days
        except (ValueError, TypeError):
            return True
    
    def cleanup_stale_entries(self, max_age_days: int = 365) -> int:
        """Remove stale entries from cache.
        
        Args:
            max_age_days: Maximum age in days
            
        Returns:
            Number of entries removed
        """
        stale_keys = [
            place_id for place_id in self._cache.keys() 
            if self.is_stale(place_id, max_age_days)
        ]
        
        for key in stale_keys:
            del self._cache[key]
        
        if stale_keys:
            self._save_cache()
        
        return len(stale_keys)
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """Get cache statistics.
        
        Returns:
            Dictionary with cache statistics
        """
        total_entries = len(self._cache)
        stale_entries = sum(1 for place_id in self._cache.keys() if self.is_stale(place_id))
        
        # Count entries with aesthetic analysis
        analyzed_entries = sum(
            1 for entry in self._cache.values() 
            if 'beauty_score' in entry or 'aesthetic_review' in entry
        )
        
        return {
            'total_entries': total_entries,
            'stale_entries': stale_entries,
            'analyzed_entries': analyzed_entries,
            'cache_file': str(self.cache_file),
            'file_size_bytes': self.cache_file.stat().st_size if self.cache_file.exists() else 0
        }
    
    def search_by_address(self, address_pattern: str) -> list[Dict[str, Any]]:
        """Search cached locations by address pattern.
        
        Args:
            address_pattern: Pattern to search for (case-insensitive)
            
        Returns:
            List of matching cache entries
        """
        pattern_lower = address_pattern.lower()
        matches = []
        
        for entry in self._cache.values():
            if pattern_lower in entry.get('address', '').lower():
                matches.append(entry)
        
        return matches


# Global cache instance
_location_cache = None

def get_location_cache(cache_file: str = "location_cache.json") -> LocationCache:
    """Get or create the global location cache instance.
    
    Args:
        cache_file: Path to cache file
        
    Returns:
        LocationCache instance
    """
    global _location_cache
    if _location_cache is None:
        _location_cache = LocationCache(cache_file)
    return _location_cache