# 🐍 Python Data Collection Tools

Python utilities for bulk London beauty data collection and analysis.

## 🎯 Purpose

This component provides tools for:
- **Sampling London coordinates** with bias toward interesting areas
- **Bulk Street View image collection** with optimization
- **AI aesthetic evaluation** using Gemini 2.5 Flash
- **Cost estimation** and rate limiting
- **Upload integration** with the web platform

## 📁 Structure

```
python/
├── beholder/              # Main Python package
│   ├── __init__.py
│   ├── coordinates.py     # London coordinate sampling
│   ├── geocoding.py       # Address resolution
│   ├── streetview.py      # Street View optimization
│   ├── aesthetic_evaluation.py  # AI evaluation
│   ├── location_cache.py  # Cache management
│   └── sampling.py        # Main sampling logic
├── images/               # Downloaded Street View images
├── main.py              # CLI entry point
├── upload_to_heatmap.py # Upload to web platform
├── test_integration.py  # Integration tests
├── location_cache.json  # Location cache file
├── pyproject.toml       # Project configuration
└── uv.lock             # Lock file
```

## 🚀 Quick Start

```bash
# Install dependencies
uv sync

# Copy environment template
cp .env.example .env  # Add your API keys

# Run sampling
python main.py --count 10 --verbose

# Upload to web platform
python upload_to_heatmap.py --recent 5
```

## 🔧 Commands

### Data Collection
```bash
# Sample 50 random London locations
python main.py --count 50

# Sample with AI evaluation
python main.py --count 10 --evaluate

# Verbose output with cost tracking
python main.py --count 5 --evaluate --verbose
```

### Upload to Web Platform
```bash
# Upload 10 most recent evaluations
python upload_to_heatmap.py --recent 10

# Upload all evaluated locations
python upload_to_heatmap.py --all

# Test API connection
python upload_to_heatmap.py --test
```

## 🎛️ Configuration

Add to `.env`:
```bash
GOOGLE_MAPS_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here
HEATMAP_API_URL=https://your-worker.workers.dev
```

## 📊 Features

### Advanced Street View
- **Method 2 optimization** with metadata API
- **Heading calculation** for optimal camera angles
- **Blank image detection** with retry logic
- **Comparison tools** for old vs new methods

### AI Evaluation
- **Detailed prompts** with examples and guidance
- **Robust parsing** with fallback extraction
- **Cost estimation** before batch operations
- **Rate limiting** to avoid API limits

### Cache Management
- **Persistent cache** to avoid duplicate API calls
- **Place ID deduplication** 
- **Incremental processing** 
- **Export capabilities**

## 🔗 Integration

This component integrates with:
- **Web API**: Upload evaluated locations
- **Database**: Via web API for storage
- **Google APIs**: Maps + Gemini for data collection

Built for bulk data collection to seed the interactive web heatmap.