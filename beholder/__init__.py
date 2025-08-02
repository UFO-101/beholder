"""Beholder - London Beauty Heatmap Generator

A tool for sampling random locations in London and collecting Street View images
for beauty classification analysis.
"""

from .sampling import sample_london_location, sample_multiple_locations, sample_batch_locations

__version__ = "0.1.0"
__all__ = [
    "sample_london_location", 
    "sample_multiple_locations", 
    "sample_batch_locations"
]