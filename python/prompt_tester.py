#!/usr/bin/env python3
"""
Interactive prompt tester for the beauty evaluation AI.
Allows you to test different prompts on sample locations and see results immediately.
"""

import asyncio
import aiohttp
import json
from typing import Dict, Any, List, Optional
from pathlib import Path
import argparse
from datetime import datetime
import webbrowser

# Configuration
API_BASE_URL = "https://beholder.josephmiller101.workers.dev"
LOCAL_API_URL = "http://localhost:8787"

# Sample locations for testing
TEST_LOCATIONS = [
    "Big Ben, London",
    "Tower Bridge, London",
    "51.505,-0.075",  # Random coordinates
    "Buckingham Palace, London",
    "Camden Market, London",
    "Shoreditch High Street, London",
    "Greenwich Park, London",
    "Notting Hill, London",
    "Brick Lane, London",
    "The Shard, London"
]


class PromptTester:
    """Test different AI prompts on sample locations."""
    
    def __init__(self, api_url: str = LOCAL_API_URL):
        self.api_url = api_url.rstrip('/')
        self.results = []
    
    async def test_single_location(self, session: aiohttp.ClientSession, address: str) -> Optional[Dict[str, Any]]:
        """Test a single location through the API."""
        print(f"\n🎯 Testing: {address}")
        print("-" * 50)
        
        try:
            async with session.post(
                f'{self.api_url}/point',
                json={'address': address},
                timeout=aiohttp.ClientTimeout(total=30)
            ) as response:
                
                if response.status in [200, 201]:
                    data = await response.json()
                    point = data['point']
                    
                    print(f"📍 Address: {point['address']}")
                    print(f"⭐ Beauty Score: {point['beauty']}/10")
                    print(f"📝 Review:")
                    
                    # Word wrap the review
                    words = point['description'].split()
                    lines = []
                    current_line = []
                    for word in words:
                        if len(' '.join(current_line + [word])) <= 70:
                            current_line.append(word)
                        else:
                            if current_line:
                                lines.append(' '.join(current_line))
                            current_line = [word]
                    if current_line:
                        lines.append(' '.join(current_line))
                    
                    for line in lines:
                        print(f"   {line}")
                    
                    if point.get('image_url'):
                        print(f"🖼️  Image: {point['image_url']}")
                    
                    return data
                
                else:
                    error_data = await response.json()
                    print(f"❌ Error: {error_data.get('error', 'Unknown error')}")
                    return None
                    
        except Exception as e:
            print(f"❌ Exception: {e}")
            return None
    
    async def test_batch(self, locations: List[str]) -> List[Dict[str, Any]]:
        """Test multiple locations."""
        print(f"🧪 Testing {len(locations)} locations...")
        print(f"🌐 API: {self.api_url}")
        print("=" * 70)
        
        async with aiohttp.ClientSession() as session:
            for location in locations:
                result = await self.test_single_location(session, location)
                if result:
                    self.results.append(result)
                
                # Small delay between requests
                await asyncio.sleep(1)
        
        return self.results
    
    def generate_comparison_html(self, filename: str = None) -> str:
        """Generate HTML file comparing all results."""
        if not self.results:
            print("⚠️  No results to display")
            return None
        
        html = """
<!DOCTYPE html>
<html>
<head>
    <title>Beauty Evaluation Results</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        h1 {
            color: #333;
            border-bottom: 2px solid #4CAF50;
            padding-bottom: 10px;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }
        .card {
            background: white;
            border-radius: 8px;
            padding: 15px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .score {
            font-size: 24px;
            font-weight: bold;
            color: #4CAF50;
            margin: 10px 0;
        }
        .address {
            font-weight: 600;
            color: #666;
            margin-bottom: 10px;
        }
        .review {
            color: #333;
            line-height: 1.6;
            font-size: 14px;
            border-left: 3px solid #4CAF50;
            padding-left: 10px;
            margin-top: 10px;
        }
        .image {
            width: 100%;
            height: 200px;
            object-fit: cover;
            border-radius: 4px;
            margin-bottom: 10px;
        }
        .stats {
            background: white;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
    </style>
</head>
<body>
    <h1>🗺️ London Beauty Evaluation Results</h1>
    
    <div class="stats">
        <h2>📊 Statistics</h2>
        <p>Total locations evaluated: <strong>{count}</strong></p>
        <p>Average beauty score: <strong>{avg:.1f}/10</strong></p>
        <p>Highest score: <strong>{max:.1f}/10</strong></p>
        <p>Lowest score: <strong>{min:.1f}/10</strong></p>
    </div>
    
    <div class="grid">
        {cards}
    </div>
</body>
</html>
        """
        
        # Calculate statistics
        scores = [r['point']['beauty'] for r in self.results]
        avg_score = sum(scores) / len(scores) if scores else 0
        max_score = max(scores) if scores else 0
        min_score = min(scores) if scores else 0
        
        # Generate cards
        cards = []
        for result in self.results:
            point = result['point']
            image_tag = f'<img class="image" src="{point.get("image_url", "")}" alt="Street view">' if point.get('image_url') else ''
            
            card = f"""
            <div class="card">
                {image_tag}
                <div class="address">{point['address']}</div>
                <div class="score">⭐ {point['beauty']}/10</div>
                <div class="review">{point['description']}</div>
            </div>
            """
            cards.append(card)
        
        # Fill in the template
        final_html = html.format(
            count=len(self.results),
            avg=avg_score,
            max=max_score,
            min=min_score,
            cards=''.join(cards)
        )
        
        # Save to file
        if filename is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"prompt_test_{timestamp}.html"
        
        output_path = Path(filename)
        with open(output_path, 'w') as f:
            f.write(final_html)
        
        print(f"\n💾 Results saved to {output_path}")
        return str(output_path)
    
    def print_summary(self):
        """Print summary statistics."""
        if not self.results:
            return
        
        scores = [r['point']['beauty'] for r in self.results]
        avg_score = sum(scores) / len(scores)
        
        print(f"\n📊 SUMMARY")
        print("=" * 50)
        print(f"Total evaluated: {len(self.results)}")
        print(f"Average score: {avg_score:.1f}/10")
        print(f"Score range: {min(scores):.1f} - {max(scores):.1f}")
        
        # Group by score ranges
        ranges = {'1-3': 0, '4-6': 0, '7-8': 0, '9-10': 0}
        for score in scores:
            if score <= 3:
                ranges['1-3'] += 1
            elif score <= 6:
                ranges['4-6'] += 1
            elif score <= 8:
                ranges['7-8'] += 1
            else:
                ranges['9-10'] += 1
        
        print(f"\nScore distribution:")
        for range_name, count in ranges.items():
            bar = '█' * int(count * 20 / len(scores))
            print(f"  {range_name}: {bar} {count}")


async def interactive_mode():
    """Run in interactive mode for prompt testing."""
    print("🧪 INTERACTIVE PROMPT TESTING MODE")
    print("=" * 50)
    print("This mode lets you test the AI evaluation on specific addresses.")
    print("The API will handle Street View fetching and AI evaluation.")
    print()
    
    # Choose API
    use_local = input("Use local API? (y/n, default=y): ").strip().lower() != 'n'
    api_url = LOCAL_API_URL if use_local else API_BASE_URL
    
    tester = PromptTester(api_url)
    
    while True:
        print("\nOptions:")
        print("1. Test single address")
        print("2. Test preset locations")
        print("3. View summary")
        print("4. Generate HTML report")
        print("5. Exit")
        
        choice = input("\nChoice (1-5): ").strip()
        
        if choice == '1':
            address = input("Enter address or coordinates: ").strip()
            if address:
                await tester.test_batch([address])
        
        elif choice == '2':
            print("\nPreset locations:")
            for i, loc in enumerate(TEST_LOCATIONS, 1):
                print(f"{i}. {loc}")
            
            selection = input("\nSelect locations (e.g., 1,3,5 or 'all'): ").strip()
            
            if selection.lower() == 'all':
                locations = TEST_LOCATIONS
            else:
                try:
                    indices = [int(x.strip()) - 1 for x in selection.split(',')]
                    locations = [TEST_LOCATIONS[i] for i in indices if 0 <= i < len(TEST_LOCATIONS)]
                except:
                    print("Invalid selection")
                    continue
            
            await tester.test_batch(locations)
        
        elif choice == '3':
            tester.print_summary()
        
        elif choice == '4':
            html_path = tester.generate_comparison_html()
            if html_path:
                open_html = input("Open in browser? (y/n): ").strip().lower() == 'y'
                if open_html:
                    webbrowser.open(f"file://{Path(html_path).absolute()}")
        
        elif choice == '5':
            break
        
        else:
            print("Invalid choice")


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Test AI prompts on London locations')
    parser.add_argument('--addresses', nargs='+', help='Addresses to test')
    parser.add_argument('--api-url', default=API_BASE_URL, help='API URL')
    parser.add_argument('--local', action='store_true', help='Use local API')
    parser.add_argument('--preset', action='store_true', help='Test all preset locations')
    parser.add_argument('--interactive', action='store_true', help='Interactive mode')
    parser.add_argument('--html', action='store_true', help='Generate HTML report')
    
    args = parser.parse_args()
    
    if args.interactive:
        await interactive_mode()
        return
    
    api_url = LOCAL_API_URL if args.local else args.api_url
    tester = PromptTester(api_url)
    
    # Determine what to test
    if args.addresses:
        locations = args.addresses
    elif args.preset:
        locations = TEST_LOCATIONS
    else:
        # Default: test a few samples
        locations = TEST_LOCATIONS[:3]
    
    # Run tests
    await tester.test_batch(locations)
    tester.print_summary()
    
    # Generate HTML if requested
    if args.html:
        html_path = tester.generate_comparison_html()
        if html_path:
            print(f"Opening {html_path} in browser...")
            webbrowser.open(f"file://{Path(html_path).absolute()}")


if __name__ == "__main__":
    asyncio.run(main())