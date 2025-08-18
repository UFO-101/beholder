# Beholder Python Tools

Lightweight Python scripts for bulk sampling and testing the London Beauty Heatmap.

## Setup

```bash
pip install -r requirements.txt
```

## Scripts

### 1. Bulk Sampler (`bulk_sampler.py`)

High-performance async script for populating the heatmap with thousands of points:

```bash
# Sample 100 random locations
python bulk_sampler.py 100

# Use local API for testing
python bulk_sampler.py 50 --local

# Sample in grid pattern
python bulk_sampler.py 100 --mode grid

# Keep sampling until 500 successful points
python bulk_sampler.py 500 --mode until

# Increase parallelism (default is 10)
python bulk_sampler.py 1000 --concurrent 25

# Save results to JSON
python bulk_sampler.py 100 --save --output results.json
```

Features:
- **Async processing**: Handle 10-50 concurrent requests
- **Smart retrying**: Automatically handles failures and duplicates
- **Multiple modes**: Random, grid, or until-target sampling
- **Progress tracking**: Real-time statistics and success rates

### 2. Prompt Tester (`prompt_tester.py`)

Interactive tool for testing and tuning AI evaluation prompts:

```bash
# Interactive mode (recommended)
python prompt_tester.py --interactive

# Test specific addresses
python prompt_tester.py --addresses "Big Ben, London" "Tower Bridge, London"

# Test all preset locations
python prompt_tester.py --preset --html

# Use local API
python prompt_tester.py --local --preset
```

Features:
- **Interactive testing**: Test individual addresses on demand
- **HTML reports**: Visual comparison of results
- **Preset locations**: Quick testing on known landmarks
- **Score analysis**: Statistics and distribution charts

## Workflow

1. **Development**: Use `prompt_tester.py --local --interactive` to test prompt changes
2. **Bulk sampling**: Use `bulk_sampler.py 1000 --concurrent 25` to populate database
3. **Production**: Point to production API without `--local` flag

## Performance Tips

- For bulk sampling, increase `--concurrent` based on your network capacity
- Grid mode provides better geographic coverage than random
- Use "until" mode when you need exactly N successful points
- The API handles deduplication via Google Place IDs

## Note

All AI evaluation now happens in the Cloudflare Worker API. These Python tools are just lightweight clients for:
- Generating random/grid coordinates
- Managing concurrent API requests  
- Testing prompt changes
- Analyzing results

No API keys needed in Python - everything goes through the Worker!